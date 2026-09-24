/**
 * asset.resolve — first-class routing policy: search/acquire, then adapt, then create.
 *
 * REQ-ASSET-008: creation routes are fallbacks, never an automatic generation step.
 * REQ-ASSET-009: every terminal decision is recorded append-only before production reliance.
 * REQ-ASSET-010: acquisition flows through the existing asset.source intake into the
 *   AssetRegistry as a pending record; per-asset license evidence is mandatory.
 * REQ-ASSET-011: providers are replaceable adapters injected below this contract.
 * REQ-ASSET-012: adaptation is a recorded decision over an existing project record; gates
 *   are never weakened here.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { AssetRegistry } from "./registry";

export interface ProviderMatch {
  provider: string;
  assetId: string;
  title: string;
  /** Per-asset license if the provider can state it at search time; null = unknown until intake. */
  license: string | null;
  sourceUri: string;
  /** Optional per-asset metadata (for example polycount) usable for declared acceptance criteria. */
  metadata?: Record<string, unknown>;
}

export type ProviderSearchOutcome =
  | { status: "success"; matches: ProviderMatch[] }
  | { status: "unavailable"; detail: string };

export type ProviderAcquireOutcome =
  | { status: "success"; assetRecord: Record<string, unknown>; files?: string[] }
  | { status: "blocked"; code: string; detail: string }
  | { status: "failed"; code: string; detail: string };

export interface AssetSourceProvider {
  readonly id: string;
  search(keywords: string[], role: string): Promise<ProviderSearchOutcome>;
  acquire(match: ProviderMatch, role: string, projectRoot: string): Promise<ProviderAcquireOutcome>;
}

export interface ResolutionStep {
  step: "search" | "acquire";
  target: string;
  provider?: string;
  outcome: "matched" | "no-match" | "unavailable" | "accepted-reuse-found" | "adapt-candidate-found" | "acquired" | "rejected-license-evidence-missing" | "rejected-license-mismatch" | "rejected-budget" | "failed" | "blocked";
  detail: string;
}

export interface ResolutionDecision {
  route: "reuse" | "acquire" | "adapt" | "create-fallback";
  reason: string;
  provider?: string;
  asset_id?: string;
  license?: string;
}

export interface ResolutionRecord {
  schema: "gauntlet.asset.resolution";
  schema_version: "1.0";
  requested_id: string;
  role: string;
  keywords: string[];
  recorded_at: string;
  steps: ResolutionStep[];
  decision: ResolutionDecision;
}

export type AssetResolveRequest = {
  requestedId: string;
  role: string;
  keywords: string[];
  projectRoot: string;
  requireLicense?: string;
  maxTriangles?: number;
};

export type AssetResolveResult =
  | {
      status: "success";
      operation: "studio.asset.resolve";
      result: {
        route: "reuse" | "acquire";
        requested_id: string;
        provider?: string;
        asset_id?: string;
        asset_record?: Record<string, unknown>;
        decision_file: string;
        steps: ResolutionStep[];
        decision: ResolutionDecision;
      };
    }
  | {
      status: "blocked";
      operation: "studio.asset.resolve";
      diagnostics: { code: "ADAPT_REQUIRED" | "CREATE_FALLBACK_REQUIRED" | "PROVIDERS_UNAVAILABLE" | "ACQUIRE_BLOCKED"; error: string };
      result: { route: "adapt" | "acquire" | "create" | "unresolved"; requested_id: string; decision_file: string; steps: ResolutionStep[]; decision: ResolutionDecision };
    }
  | {
      status: "failed";
      operation: "studio.asset.resolve";
      diagnostics: { code: string; error: string };
      result?: { requested_id: string; decision_file?: string; steps: ResolutionStep[]; decision?: ResolutionDecision };
    };

export class AssetResolver {
  constructor(
    private readonly options: {
      providers: AssetSourceProvider[];
      now?: () => string;
    },
  ) {}

  async resolve(request: AssetResolveRequest): Promise<AssetResolveResult> {
    const requestedId = request.requestedId?.trim() ?? "";
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(requestedId)) {
      return { status: "failed", operation: "studio.asset.resolve", diagnostics: { code: "REQUESTED_ID_INVALID", error: "asset resolve requires a normalized requested id" } };
    }
    const role = request.role?.trim() ?? "";
    if (!role) {
      return { status: "failed", operation: "studio.asset.resolve", diagnostics: { code: "ROLE_REQUIRED", error: "asset resolve requires --role <role>" } };
    }
    const keywords = (request.keywords ?? []).map(k => k.trim()).filter(k => k.length > 0);
    const steps: ResolutionStep[] = [];
    const now = this.options.now ?? (() => new Date().toISOString());

    const registry = new AssetRegistry(request.projectRoot);
    registry.load();

    // Search, cheapest first: the project registry itself.
    const existing = registry.get(requestedId);
    if (existing && existing.acceptance_state === "accepted") {
      steps.push({ step: "search", target: "project-registry", outcome: "accepted-reuse-found", detail: `accepted project asset '${requestedId}' satisfies the request` });
      const decision: ResolutionDecision = { route: "reuse", reason: "accepted project asset satisfies the request; acquisition skipped", asset_id: requestedId };
      const file = this.record(request.projectRoot, { requestedId: request.requestedId, role, keywords, now, steps, decision });
      return { status: "success", operation: "studio.asset.resolve", result: { route: "reuse", requested_id: requestedId, asset_id: requestedId, asset_record: existing as unknown as Record<string, unknown>, decision_file: file, steps, decision } };
    }
    steps.push({ step: "search", target: "project-registry", outcome: existing ? "adapt-candidate-found" : "no-match", detail: existing ? `project asset '${requestedId}' exists with acceptance_state '${existing.acceptance_state}'` : "no project asset matches the requested id" });

    // Search/acquire: registered external providers, in declared order.
    let providerUnavailable = 0;
    for (const provider of this.options.providers) {
      const search = await provider.search(keywords, role);
      if (search.status === "unavailable") {
        providerUnavailable++;
        steps.push({ step: "search", target: `provider:${provider.id}`, provider: provider.id, outcome: "unavailable", detail: search.detail });
        continue;
      }
      if (search.matches.length === 0) {
        steps.push({ step: "search", target: `provider:${provider.id}`, provider: provider.id, outcome: "no-match", detail: "provider returned no matches for the request keywords" });
        continue;
      }
      if (!search.matches.some(m => {
        const polycount = (m.metadata as { polycount?: unknown } | undefined)?.polycount;
        return typeof polycount !== "number" || !request.maxTriangles || polycount <= request.maxTriangles;
      })) {
        steps.push({ step: "search", target: `provider:${provider.id}`, provider: provider.id, outcome: "no-match", detail: `every match exceeds the declared triangle budget ${request.maxTriangles}` });
        continue;
      }
      // Declared acceptance criteria filter candidates before acquisition.
      const candidates = request.maxTriangles
        ? search.matches.filter(m => {
            const polycount = (m.metadata as { polycount?: unknown } | undefined)?.polycount;
            if (typeof polycount !== "number") return true;
            if (polycount > request.maxTriangles!) {
              steps.push({ step: "search", target: `provider:${provider.id}`, provider: provider.id, outcome: "rejected-budget", detail: `'${m.assetId}' polycount ${polycount} exceeds the declared budget ${request.maxTriangles}` });
              return false;
            }
            return true;
          })
        : search.matches;
      // Acquire tries matches in provider order; a candidate that cannot be
      // acquired (for example no downloadable form) falls through to the next.
      let lastFailure: { blocked: boolean; code: string; detail: string; assetId: string } | null = null;
      for (const match of candidates) {
        steps.push({ step: "search", target: `provider:${provider.id}`, provider: provider.id, outcome: "matched", detail: `matched '${match.assetId}' (${match.title})` });
        const acquire = await provider.acquire(match, role, request.projectRoot);
        if (acquire.status !== "success") {
          lastFailure = { blocked: acquire.status === "blocked", code: acquire.code, detail: acquire.detail, assetId: match.assetId };
          steps.push({ step: "acquire", target: `provider:${provider.id}`, provider: provider.id, outcome: acquire.status === "blocked" ? "blocked" : "failed", detail: `${acquire.code}: ${acquire.detail}` });
          continue;
        }

      // Per-asset license evidence is mandatory before registry intake.
      const provenance = (acquire.assetRecord as { source_provenance?: { license?: unknown } }).source_provenance;
      const license = typeof provenance?.license === "string" ? provenance.license.trim() : "";
      if (!license) {
        steps.push({ step: "acquire", target: `provider:${provider.id}`, provider: provider.id, outcome: "rejected-license-evidence-missing", detail: "acquired asset record carries no per-asset license evidence" });
        const decisionFile = this.record(request.projectRoot, { requestedId: request.requestedId, role, keywords, now, steps, decision: { route: "acquire", reason: "rejected: no per-asset license evidence", provider: provider.id, asset_id: match.assetId } });
        return { status: "failed", operation: "studio.asset.resolve", diagnostics: { code: "PROVIDER_LICENSE_EVIDENCE_MISSING", error: "acquired asset record carries no per-asset license evidence; provider-level assumptions are not accepted" }, result: { requested_id: requestedId, decision_file: decisionFile, steps } };
      }
      if (request.requireLicense && license.toUpperCase() !== request.requireLicense.trim().toUpperCase()) {
        steps.push({ step: "acquire", target: `provider:${provider.id}`, provider: provider.id, outcome: "rejected-license-mismatch", detail: `acquired license '${license}' does not satisfy required '${request.requireLicense}'` });
        const decisionFile = this.record(request.projectRoot, { requestedId: request.requestedId, role, keywords, now, steps, decision: { route: "acquire", reason: `rejected: license '${license}' does not satisfy '${request.requireLicense}'`, provider: provider.id, asset_id: match.assetId, license } });
        return { status: "failed", operation: "studio.asset.resolve", diagnostics: { code: "LICENSE_MISMATCH", error: `acquired asset license '${license}' does not satisfy the declared requirement '${request.requireLicense}'` }, result: { requested_id: requestedId, decision_file: decisionFile, steps } };
      }

      let stored: { record: { id: string }; provenance_violations: string[]; state: string };
      try {
        stored = registry.intake(acquire.assetRecord);
      } catch (err) {
        steps.push({ step: "acquire", target: `provider:${provider.id}`, provider: provider.id, outcome: "failed", detail: `registry intake rejected the asset record: ${err instanceof Error ? err.message : String(err)}` });
        const decisionFile = this.record(request.projectRoot, { requestedId: request.requestedId, role, keywords, now, steps, decision: { route: "acquire", reason: "registry intake rejected the asset record", provider: provider.id, asset_id: match.assetId, license } });
        return { status: "failed", operation: "studio.asset.resolve", diagnostics: { code: "REGISTRY_INTAKE_REJECTED", error: `the AssetRegistry rejected the acquired asset record: ${err instanceof Error ? err.message : String(err)}` }, result: { requested_id: requestedId, decision_file: decisionFile, steps } };
      }
      registry.save();
      const violationNote = stored.provenance_violations.length > 0 ? `; registry recorded ${stored.provenance_violations.length} provenance violation(s) and held the record in '${stored.state}' state` : "";
      steps.push({ step: "acquire", target: `provider:${provider.id}`, provider: provider.id, outcome: "acquired", detail: `acquired '${match.assetId}' into the registry as a '${stored.state}' record with license '${license}'${violationNote}` });
      const decision: ResolutionDecision = { route: "acquire", reason: `provider match acquired through asset.source intake as a '${stored.state}' record; acceptance is a separate registry decision`, provider: provider.id, asset_id: match.assetId, license };
      const file = this.record(request.projectRoot, { requestedId: request.requestedId, role, keywords, now, steps, decision });
      return { status: "success", operation: "studio.asset.resolve", result: { route: "acquire", requested_id: requestedId, provider: provider.id, asset_id: match.assetId, asset_record: acquire.assetRecord, decision_file: file, steps, decision } };
      }
      if (lastFailure) {
        const decision: ResolutionDecision = { route: "acquire", reason: `all ${search.matches.length} provider matches failed acquisition (${lastFailure.code})`, provider: provider.id };
        const decisionFile = this.record(request.projectRoot, { requestedId: request.requestedId, role, keywords, now, steps, decision });
        return lastFailure.blocked
          ? { status: "blocked", operation: "studio.asset.resolve", diagnostics: { code: "ACQUIRE_BLOCKED", error: lastFailure.detail }, result: { route: "acquire", requested_id: requestedId, decision_file: decisionFile, steps, decision } }
          : { status: "failed", operation: "studio.asset.resolve", diagnostics: { code: lastFailure.code, error: lastFailure.detail }, result: { requested_id: requestedId, decision_file: decisionFile, steps, decision } };
      }
    }

    if (providerUnavailable > 0 && providerUnavailable === this.options.providers.length) {
      steps.push({ step: "search", target: "providers", outcome: "unavailable", detail: "every registered provider was unavailable; absence of a match cannot be concluded" });
      const decisionFile = this.record(request.projectRoot, { requestedId: request.requestedId, role, keywords, now, steps, decision: { route: "create-fallback", reason: "blocked: providers unavailable; the search step cannot be completed" } });
      return { status: "blocked", operation: "studio.asset.resolve", diagnostics: { code: "PROVIDERS_UNAVAILABLE", error: "every registered provider was unavailable; resolve cannot conclude" }, result: { route: "unresolved", requested_id: requestedId, decision_file: decisionFile, steps, decision: { route: "create-fallback", reason: "blocked: providers unavailable; the search step could not be completed" } } };
    }

    // Adapt: an existing project record that needs work is preferred over creation.
    if (existing) {
      steps.push({ step: "acquire", target: "project-registry", outcome: "adapt-candidate-found", detail: `existing project asset '${requestedId}' (${existing.acceptance_state}) can be adapted instead of created` });
      const decision: ResolutionDecision = { route: "adapt", reason: `existing project asset '${requestedId}' is ${existing.acceptance_state}; adapt it under its gates before considering creation`, asset_id: requestedId };
      const file = this.record(request.projectRoot, { requestedId: request.requestedId, role, keywords, now, steps, decision });
      return { status: "blocked", operation: "studio.asset.resolve", diagnostics: { code: "ADAPT_REQUIRED", error: `existing project asset '${requestedId}' is ${existing.acceptance_state}; adapt it before considering creation` }, result: { route: "adapt", requested_id: requestedId, decision_file: file, steps, decision } };
    }

    // Create fallback: recorded, never executed here.
    steps.push({ step: "acquire", target: "creation-routes", outcome: "no-match", detail: "no existing or acquirable asset; creation is the recorded fallback via the existing capability routes" });
    const decision: ResolutionDecision = { route: "create-fallback", reason: "no accepted project asset, provider match, or adapt candidate exists; route creation through the existing capability routes (procedural, reference reconstruction, DCC)" };
    const file = this.record(request.projectRoot, { requestedId: request.requestedId, role, keywords, now, steps, decision });
    return { status: "blocked", operation: "studio.asset.resolve", diagnostics: { code: "CREATE_FALLBACK_REQUIRED", error: "no suitable existing asset can be acquired or adapted; creation fallback required via the existing capability routes" }, result: { route: "create", requested_id: requestedId, decision_file: file, steps, decision } };
  }

  private record(
    projectRoot: string,
    input: { requestedId: string; role: string; keywords: string[]; now: () => string; steps: ResolutionStep[]; decision: ResolutionDecision },
  ): string {
    const dir = path.join(projectRoot, ".studio", "resolutions");
    fs.mkdirSync(dir, { recursive: true });
    const record: ResolutionRecord = {
      schema: "gauntlet.asset.resolution",
      schema_version: "1.0",
      requested_id: input.requestedId,
      role: input.role,
      keywords: input.keywords,
      recorded_at: input.now(),
      steps: input.steps,
      decision: input.decision,
    };
    // Append-only by exclusive creation: an existing decision file is never rewritten.
    const base = `${input.requestedId}.${record.recorded_at.replace(/[:.]/g, "-")}`;
    let file = path.join(dir, `${base}.json`);
    let suffix = 0;
    for (;;) {
      try {
        fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
        return file;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          file = path.join(dir, `${base}-${++suffix}.json`);
          continue;
        }
        throw err;
      }
    }
  }
}
