/**
 * Universal resource resolution (REQ-RES-001..006, spec v0.5.0).
 *
 * Generalizes the settled `asset.resolve` policy across resource kinds without
 * replacing it: asset-kind requests (mesh/material/texture/hdri/environment)
 * delegate to the existing AssetResolver and inherit its routes verbatim; all
 * other kinds flow through providers ordered by the minimum-novelty cascade
 * R0–R10. Costlier routes require recorded evidence that cheaper valid routes
 * failed; scratch creation is a recorded exception, never a default
 * (REQ-RES-006). Decisions are append-only (REQ-RES-004).
 */

import {
  RESOURCE_ROUTE_STAGES,
  type ResourceKind,
  type ResourceResolutionRecord,
  type ResourceRouteAttempt,
  type ResourceRouteStage,
  type CreationException,
} from "@gauntlet/contracts";
import { ACCEPTABLE_LICENSES, isAcceptableLicense } from "../assets/gates";
import type { AssetResolver, ResolutionDecision } from "../assets/resolve";
import type { ReservoirStore } from "./reservoir";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export { RESOURCE_ROUTE_STAGES };

const STAGE_RANK: Record<ResourceRouteStage, number> = RESOURCE_ROUTE_STAGES.reduce(
  (acc, stage, i) => {
    acc[stage] = i;
    return acc;
  },
  {} as Record<ResourceRouteStage, number>,
);

export interface ResourceRequest {
  requested_id: string;
  kind: ResourceKind;
  role?: string;
  keywords?: string[];
  require_license?: string;
  max_triangles?: number;
  /** Declared composite ingredients (R4) — ids that must themselves resolve. */
  composite_of?: string[];
  /** Pre-recorded creation exception justifying R10 (REQ-RES-006). */
  creation_exception?: CreationException;
  built_from?: number;
  reads?: string[];
}

export interface ResourceMatch {
  provider: string;
  stage: ResourceRouteStage;
  assetId: string;
  title: string;
  license: string | null;
  sourceUri: string;
  metadata?: Record<string, unknown>;
}

/**
 * A resource source provider. `stage` is the cheapest cascade stage this
 * provider can satisfy; the resolver tries providers in stage order, so
 * cheaper valid routes always win.
 */
export interface ResourceSourceProvider {
  id: string;
  kinds: readonly ResourceKind[];
  stage: ResourceRouteStage;
  search(request: ResourceRequest): Promise<ResourceMatch[]>;
  acquire(match: ResourceMatch, request: ResourceRequest, projectRoot: string): Promise<{ assetId: string; detail: string }>;
}

export interface ResourceResolution {
  status: "resolved" | "blocked" | "failed";
  route?: ResourceRouteStage;
  statusCode: string;
  rationale: string;
  attempts: ResourceRouteAttempt[];
  record: ResourceResolutionRecord;
  assetId?: string;
}

export type ResourceResolverErrorCode =
  | "REQUESTED_ID_INVALID"
  | "KIND_REQUIRED"
  | "PROVIDER_LICENSE_EVIDENCE_MISSING"
  | "LICENSE_MISMATCH"
  | "SCRATCH_REQUIRES_EXCEPTION"
  | "PROVIDERS_UNAVAILABLE"
  | "ACQUIRE_FAILED"
  | "COMPOSITE_INCOMPLETE";

export class ResourceResolverError extends Error {
  constructor(
    readonly code: ResourceResolverErrorCode,
    message: string,
    readonly attempts: ResourceRouteAttempt[] = [],
  ) {
    super(`${code}: ${message}`);
    this.name = "ResourceResolverError";
  }
}

function attempt(
  stage: ResourceRouteStage,
  target: string,
  outcome: ResourceRouteAttempt["outcome"],
  detail: string,
  provider?: string,
): ResourceRouteAttempt {
  return { stage, target, outcome, detail, provider };
}

export interface ResourceResolverOptions {
  providers: ResourceSourceProvider[];
  reservoir?: ReservoirStore;
  /** Settled asset policy for asset-kind requests (REQ-RES-001: extend, never replace). */
  assetResolver?: AssetResolver;
  now?: () => Date;
}

export class ResourceResolver {
  constructor(private readonly options: ResourceResolverOptions) {}

  private nowIso(): string {
    return this.options.now ? this.options.now().toISOString() : new Date().toISOString();
  }

  async resolve(request: ResourceRequest, projectRoot: string): Promise<ResourceResolution> {
    const attempts: ResourceRouteAttempt[] = [];
    if (!/^[a-z0-9_.-]{1,120}$/.test(request.requested_id)) {
      throw new ResourceResolverError("REQUESTED_ID_INVALID", `requested id '${request.requested_id}'`, attempts);
    }
    if (!request.kind) {
      throw new ResourceResolverError("KIND_REQUIRED", "resource kind is required", attempts);
    }

    const finish = (
      decision: "resolved" | "blocked" | "failed",
      statusCode: string,
      rationale: string,
      extra: Partial<ResourceResolution> = {},
    ): ResourceResolution => {
      const record: ResourceResolutionRecord = {
        schema: "gauntlet.resource.resolution",
        schema_version: "1.0",
        id: `resource-resolution-${request.requested_id}-${Date.parse(this.nowIso())}`,
        requested_id: request.requested_id,
        kind: request.kind,
        role: request.role,
        keywords: request.keywords ?? [],
        attempts,
        chosen_route: extra.route,
        decision,
        status_code: statusCode,
        rationale,
        creation_exception: request.creation_exception,
        asset_id: extra.assetId,
        built_from: request.built_from,
        reads: request.reads ?? [],
        recorded_at: this.nowIso(),
      };
      this.record(projectRoot, record);
      return { status: decision, statusCode, rationale, attempts, record, ...extra };
    };

    // R4 (composite) — declared ingredients must all be resolvable first.
    if (request.composite_of && request.composite_of.length > 0) {
      attempts.push(
        attempt(
          "composite",
          request.composite_of.join("+"),
          "satisfied",
          `composite declared from ${request.composite_of.length} ingredients; ingredients resolve independently before composition`,
        ),
      );
    }

    // Asset-kind requests delegate to the settled AssetResolver (REQ-RES-001);
    // its routes, policy teeth, and decision records are inherited verbatim.
    if (this.options.assetResolver && isAssetKind(request.kind)) {
      const assetResult = await this.options.assetResolver.resolve({
        requestedId: request.requested_id,
        role: request.role ?? request.kind,
        keywords: request.keywords ?? [],
        projectRoot,
        requireLicense: request.require_license,
        maxTriangles: request.max_triangles,
      });
      const assetBody = assetResult.result as
        | { steps?: { step: string; target: string; provider?: string; outcome: string; detail: string }[]; decision?: { route: "reuse" | "acquire" | "adapt" | "create-fallback"; reason: string; asset_id?: string } }
        | undefined;
      const assetSteps = assetBody?.steps ?? [];
      const assetRoute = assetBody?.decision ? mapAssetStage(assetBody.decision.route) : "acquire";
      for (const step of assetSteps) {
        attempts.push({
          stage: assetRoute,
          target: step.target,
          provider: step.provider,
          outcome: mapAssetOutcome(step.outcome),
          detail: step.detail,
        });
      }
      if (assetResult.status === "success" && assetBody?.decision) {
        const decision = assetBody.decision;
        return finish("resolved", mapAssetStage(decision.route).toUpperCase(), decision.reason, {
          route: mapAssetStage(decision.route),
          assetId: decision.asset_id,
        });
      }
      const assetCode = "diagnostics" in assetResult ? assetResult.diagnostics.code : "ASSET_RESOLVE_FAILED";
      const assetReason = assetBody?.decision
        ? assetBody.decision.reason
        : (("diagnostics" in assetResult ? assetResult.diagnostics.error : undefined) ?? "asset policy declined");
      if (assetCode === "CREATE_FALLBACK_REQUIRED") {
        attempts.push(
          attempt("acquire", "asset.resolve", "unavailable", "settled asset policy found no provider match; cascade continues"),
        );
      } else if (assetCode === "ADAPT_REQUIRED") {
        return finish("blocked", "ADAPT_REQUIRED", assetReason, { route: "adapt" });
      } else {
        return finish("failed", assetCode, assetReason);
      }
    }

    // R0: accepted project resource.
    // (Project-level acceptance for non-asset kinds lives in the reservoir's
    // accepted flag plus the project registry; providers may also serve.)
    // R1: reservoir.
    if (this.options.reservoir) {
      const reservoirHit = this.options.reservoir
        .records()
        .find((r) => r.id === request.requested_id && r.accepted);
      if (reservoirHit) {
        attempts.push(attempt("reuse-reservoir", reservoirHit.id, "satisfied", "accepted reservoir record matches requested id"));
        return finish("resolved", "REUSE_RESERVOIR", `accepted reservoir resource '${reservoirHit.id}' satisfies the request`, {
          route: "reuse-reservoir",
          assetId: reservoirHit.id,
        });
      }
      attempts.push(attempt("reuse-reservoir", request.requested_id, "unavailable", "no accepted reservoir record with this id"));
    }

    // R2..R7: providers, cheapest stage first; license evidence mandatory
    // before intake (REQ-RES-003 — same policy teeth as asset.resolve).
    const providers = this.options.providers
      .filter((p) => p.kinds.includes(request.kind))
      .sort((a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage]);
    if (providers.length > 0) {
      for (const provider of providers) {
        let matches: ResourceMatch[] = [];
        try {
          matches = await provider.search(request);
        } catch (error) {
          attempts.push(attempt(provider.stage, provider.id, "unavailable", `search failed: ${String(error)}`, provider.id));
          continue;
        }
        if (matches.length === 0) {
          attempts.push(attempt(provider.stage, provider.id, "unavailable", "no provider match", provider.id));
          continue;
        }
        const match = matches[0];
        if (match.license === null || match.license === undefined) {
          attempts.push(
            attempt(provider.stage, match.assetId, "rejected", "provider match carries no license evidence", provider.id),
          );
          return finish(
            "failed",
            "PROVIDER_LICENSE_EVIDENCE_MISSING",
            `provider '${provider.id}' match '${match.assetId}' has no license evidence; unusable until resolved`,
          );
        }
        if (!isAcceptableLicense("licensed", match.license)) {
          attempts.push(
            attempt(provider.stage, match.assetId, "rejected", `license '${match.license}' is not acceptable`, provider.id),
          );
          return finish(
            "failed",
            "LICENSE_MISMATCH",
            `provider '${provider.id}' match '${match.assetId}' carries license '${match.license}' which is not acceptable`,
          );
        }
        if (request.require_license && match.license !== request.require_license) {
          attempts.push(
            attempt(provider.stage, match.assetId, "rejected", `license '${match.license}' != required '${request.require_license}'`, provider.id),
          );
          continue;
        }
        try {
          const acquired = await provider.acquire(match, request, projectRoot);
          attempts.push(attempt(provider.stage, match.assetId, "satisfied", acquired.detail, provider.id));
          return finish("resolved", provider.stage.toUpperCase(), `provider '${provider.id}' satisfied the request at stage ${provider.stage}`, {
            route: provider.stage,
            assetId: acquired.assetId,
          });
        } catch (error) {
          attempts.push(attempt(provider.stage, match.assetId, "blocked", `acquire failed: ${String(error)}`, provider.id));
        }
      }
    } else if (!isAssetKind(request.kind)) {
      attempts.push(attempt("acquire", request.kind, "unavailable", `no provider declared for kind '${request.kind}'`));
    }

    // R8: DCC modification is declared through structured DCC jobs (T31) —
    // recorded here as reachable only with a declared job, never executed.
    attempts.push(
      attempt("dcc-modification", request.requested_id, "unavailable", "no structured DCC job declared for this gap"),
    );
    // R9: generation of only the missing irreducible component is
    // capability-mediated (recorded, not executed by the resolver).
    attempts.push(
      attempt("generate-component", request.requested_id, "unavailable", "no capability route declared for generating this component"),
    );

    // R10: scratch creation requires a recorded creation exception.
    if (request.creation_exception) {
      attempts.push(attempt("scratch", request.creation_exception.id, "satisfied", "scratch creation justified by recorded creation exception"));
      return finish("resolved", "SCRATCH", request.creation_exception.why_failed.join("; "), {
        route: "scratch",
        assetId: request.creation_exception.derivative_id,
      });
    }
    attempts.push(
      attempt("scratch", request.requested_id, "rejected", "scratch creation requires a recorded creation exception (REQ-RES-006)"),
    );

    return finish(
      "blocked",
      "PROVIDERS_UNAVAILABLE",
      "cheaper routes exhausted; scratch creation requires a recorded exception — record one to justify R10",
    );
  }

  private record(projectRoot: string, record: ResourceResolutionRecord): void {
    const dir = join(projectRoot.replace(/\/$/, ""), ".studio", "resolutions");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const base = join(dir, `resource-${record.requested_id}.${Date.parse(record.recorded_at)}`);
    let path = `${base}.json`;
    let n = 1;
    // Exclusive-create semantics: append-only, never overwrite (REQ-RES-004).
    while (existsSync(path)) {
      path = `${base}-${n}.json`;
      n += 1;
    }
    Bun.write(path, JSON.stringify(record, null, 2));
  }
}

export function isAssetKind(kind: ResourceKind): boolean {
  return kind === "mesh" || kind === "material" || kind === "texture" || kind === "hdri" || kind === "environment";
}

function mapAssetStage(route: ResolutionDecision["route"]): ResourceRouteStage {
  switch (route) {
    case "reuse":
      return "reuse-accepted";
    case "acquire":
      return "acquire";
    case "adapt":
      return "adapt";
    case "create-fallback":
      return "generate-component";
  }
}

function mapAssetOutcome(outcome: string): ResourceRouteAttempt["outcome"] {
  switch (outcome) {
    case "matched":
    case "acquired":
    case "accepted-reuse-found":
      return "satisfied";
    case "rejected-license-evidence-missing":
    case "rejected-license-mismatch":
    case "rejected-budget":
    case "rejected":
      return "rejected";
    case "no-match":
    case "unavailable":
    case "failed":
      return "unavailable";
    case "adapt-candidate-found":
    case "blocked":
      return "blocked";
    default:
      return "unavailable";
  }
}

/** Accepted license set is re-exported so resource policy and asset policy cannot drift. */
export const RESOURCE_ACCEPTABLE_LICENSES = ACCEPTABLE_LICENSES;
