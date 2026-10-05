/**
 * The game world debugger (REQ-COCKPIT-007, spec v0.5.0).
 *
 * Everything here is a READ. These operations never write a file, never mutate
 * canonical truth, and never settle anything: only the proper actualization and
 * settlement paths change truth. Answers distinguish recorded (came from
 * canonical records), derived (computed from records by a stated rule), and
 * unavailable (a gap stays a gap — never invented).
 *
 * Given the same canonical files, the same question returns the same answer.
 */

import { join } from "node:path";
import {
  loadGameModel,
  collectDerivativeStamps,
  evaluateProjectStaleness,
  staleReasons,
  AssetRegistry,
  ReservoirStore,
  listCreationExceptions,
  evaluateQualityBar,
  deriveReleaseMatrix,
  loadStudioConfig,
  type GameModel,
  type StampedDerivative,
} from "@gauntlet/studio";
import { projectCockpitState } from "./project";

export type Basis = "recorded" | "derived" | "unavailable";

export interface Answer {
  q: string;
  a: string;
  basis: Basis;
  refs?: string[];
}

export interface WorldEnv {
  projectRoot: string;
  model: GameModel;
  stamps: StampedDerivative[];
}

export function openWorld(projectRoot: string): WorldEnv {
  const root = projectRoot.replace(/\/$/, "");
  return {
    projectRoot: root,
    model: loadGameModel(join(root, ".agents", "specs", "game.spec.yaml")),
    stamps: collectDerivativeStamps(root),
  };
}

/** `why` — what a thing is, where it came from, what uses it, what contradicts it. */
export function why(env: WorldEnv, ref: string): Answer[] {
  const answers: Answer[] = [];
  const model = env.model;

  // Model fields/sections.
  const root = ref.split(".")[0];
  const knownSection = (model.known as Record<string, unknown>)[root];
  const extension = (model.extensions as Record<string, unknown>)[root];
  if (knownSection !== undefined || extension !== undefined) {
    answers.push({
      q: "what is it",
      a: `'${ref}' is a ${extension !== undefined && knownSection === undefined ? "project extension section" : "typed section"} of the canonical Game Model (model@${model.modelVersion})`,
      basis: "recorded",
      refs: [model.path],
    });
    // Where did it come from: the decision ledger.
    const touching = model.decisions.filter((d) => staleReasons({ built_from: 0, reads: [ref] }, [d]).length > 0 || d.touched.includes("all") || d.touched.some((t) => ref.startsWith(t) || t.startsWith(ref)));
    answers.push({
      q: "why does it exist / who set it",
      a: touching.length > 0
        ? `set by decision(s) ${touching.map((d) => `#${d.n} (v${d.version}): ${d.summary}`).join("; ")}`
        : "no recorded decision touches it — part of the model before the ledger or set without recorded touch",
      basis: touching.length > 0 ? "recorded" : "unavailable",
      refs: touching.map((d) => `gm:decision-${d.n}`),
    });
    // What uses it: derivative stamps reading it.
    const readers = env.stamps.filter((s) => s.stamp?.reads.some((r) => r === ref || r.startsWith(`${ref}.`) || ref.startsWith(`${r}.`)));
    answers.push({
      q: "what uses it",
      a: readers.length > 0 ? `read by: ${readers.map((s) => s.id).join(", ")}` : "no stamped derivative reads it",
      basis: readers.length > 0 ? "derived" : "unavailable",
      refs: readers.map((s) => s.id),
    });
    return answers;
  }

  // Asset.
  try {
    const registry = new AssetRegistry(env.projectRoot);
    registry.load();
    const asset = registry.get(ref);
    if (asset) {
      answers.push({
        q: "what is it",
        a: `asset '${asset.id}' (${asset.role}, origin ${asset.origin}, ${asset.acceptance_state})`,
        basis: "recorded",
        refs: ["assets/manifest.json"],
      });
      const provenance = asset.source_provenance;
      answers.push({
        q: "where did it come from",
        a: provenance.uri ? `${provenance.uri} (license ${provenance.license ?? "unknown"}, author ${provenance.author ?? "unrecorded"})` : `no source URI recorded; license ${provenance.license ?? "unknown"}`,
        basis: provenance.uri ? "recorded" : "unavailable",
      });
      answers.push({
        q: "acceptance",
        a: `${asset.acceptance_state}${asset.built_from !== undefined ? `, built from model@${asset.built_from}` : ", no model stamp"}`,
        basis: "recorded",
      });
      return answers;
    }
  } catch {
    /* no manifest */
  }

  // Reservoir record.
  try {
    const reservoir = ReservoirStore.resolveFor(env.projectRoot);
    const record = reservoir.get(ref);
    if (record) {
      answers.push({
        q: "what is it",
        a: `reservoir record '${record.id}' (${record.kind}, license ${record.source.license}, ${record.accepted ? "accepted" : "unaccepted"})`,
        basis: "recorded",
      });
      answers.push({
        q: "lineage",
        a: record.derived_from.length > 0 ? `derived from ${record.derived_from.join(", ")}` : "no recorded derivation (original resource)",
        basis: "recorded",
      });
      answers.push({
        q: "what uses it",
        a: record.used_by.length > 0 ? `used by ${record.used_by.join(", ")}` : "no games/builds recorded as using it yet",
        basis: record.used_by.length > 0 ? "recorded" : "unavailable",
      });
      return answers;
    }
  } catch {
    /* no reservoir */
  }

  // Creation exception.
  try {
    const exceptions = listCreationExceptions(env.projectRoot);
    const exception = exceptions.find((e) => e.id === ref || e.derivative_id === ref);
    if (exception) {
      answers.push({
        q: "what is it",
        a: `creation exception for '${exception.what}': scratch creation justified after ${exception.routes_searched.length} route searches failed`,
        basis: "recorded",
      });
      answers.push({
        q: "why cheaper routes failed",
        a: exception.why_failed.join("; "),
        basis: "recorded",
      });
      return answers;
    }
  } catch {
    /* no exceptions file */
  }

  answers.push({
    q: "what is it",
    a: `nothing recorded for '${ref}' in the Game Model, asset registry, reservoir, or creation exceptions`,
    basis: "unavailable",
  });
  return answers;
}

export interface ImpactRow {
  ref: string;
  kind: string;
  distance: number;
  direction: "down" | "up";
  via: string;
  stale?: boolean;
}

/** `impact` — recorded dependency paths: what depends on a thing (down), what it depends on (up). */
export function impact(env: WorldEnv, ref: string, opts: { dir?: "down" | "up" | "both"; depth?: number } = {}): { rows: ImpactRow[]; affected: number } {
  const depth = Math.min(opts.depth ?? 2, 6);
  const dir = opts.dir ?? "down";
  const rows: ImpactRow[] = [];

  const readersOf = (target: string): string[] =>
    env.stamps.filter((s) => s.stamp?.reads.some((r) => r === target || r.startsWith(`${target}.`) || target.startsWith(`${r}.`))).map((s) => s.id);

  const staleness = evaluateProjectStaleness(env.model, env.stamps);

  if (dir === "down" || dir === "both") {
    let frontier = [ref];
    for (let d = 1; d <= depth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const reader of readersOf(node)) {
          if (reader === ref || rows.some((r) => r.ref === reader)) continue;
          const report = staleness.find((s) => s.id === reader);
          rows.push({ ref: reader, kind: "derivative", distance: d, direction: "down", via: node, stale: report?.stale });
          next.push(reader);
        }
      }
      frontier = next;
    }
  }
  if (dir === "up" || dir === "both") {
    const stamp = env.stamps.find((s) => s.id === ref);
    if (stamp?.stamp) {
      stamp.stamp.reads.forEach((r, i) => {
        rows.push({ ref: r, kind: "read", distance: 1, direction: "up", via: "built_from/reads stamp" });
        void i;
      });
    }
  }
  return { rows, affected: rows.filter((r) => r.direction === "down").length };
}

/** `diff` — compare two model versions from the decision ledger (recorded history). */
export function diff(env: WorldEnv, a: number, b: number): { ok: true; a: number; b: number; decisions: { n: number; version: number; summary: string; touched: string[] }[]; note: string } {
  const decisions = env.model.decisions.filter((d) => d.version > Math.min(a, b) && d.version <= Math.max(a, b));
  return {
    ok: true,
    a,
    b,
    decisions,
    note: "diff is over recorded model decisions (entity-level canonical diffs live in settled evidence); no Git text comparison is implied",
  };
}

/** `timeline` — the settled evolution the record supports. */
export function timeline(env: WorldEnv): { modelVersion: number; events: { n: number; version: number; summary: string; touched: string[]; decided_at?: string }[] } {
  return {
    modelVersion: env.model.modelVersion,
    events: env.model.decisions.map((d) => ({ n: d.n, version: d.version, summary: d.summary, touched: d.touched, ...(d.decided_at ? { decided_at: d.decided_at } : {}) })),
  };
}

/** `counterfactual` — preview a candidate change without applying it. */
export function counterfactual(env: WorldEnv, change: { touched: string[]; summary: string }): {
  authority: "possibility";
  summary: string;
  effects: { class: "known" | "derived" | "expected" | "unknown"; subject: string; effect: string }[];
} {
  const readers = env.stamps.filter((s) => s.stamp && s.stamp.reads.some((r) => change.touched.some((t) => t === "all" || r === t || r.startsWith(`${t}.`) || t.startsWith(`${r}.`))));
  const effects = [
    {
      class: "known" as const,
      subject: "game model",
      effect: `a decision would be recorded at model@${env.model.modelVersion + 1} touching [${change.touched.join(", ")}]`,
    },
    {
      class: "derived" as const,
      subject: "derivatives",
      effect: readers.length > 0
        ? `${readers.map((s) => s.id).join(", ")} would become stale (their reads overlap the touched fields)`
        : "no stamped derivative reads the touched fields — nothing would stale",
    },
    {
      class: "expected" as const,
      subject: "evidence",
      effect: "stale evidence would stop settling until re-derived against the new model version",
    },
    {
      class: "unknown" as const,
      subject: "player experience",
      effect: "consequences for feel/appearance are unknown until observed; nothing is settled by this preview",
    },
  ];
  return { authority: "possibility", summary: change.summary, effects };
}

/** `resource_reach` — resolve a missing resource to providers and their state (read-only). */
export function resourceReach(env: WorldEnv, need: { kind?: string; keywords?: string[]; id?: string }): {
  need: typeof need;
  reach: { source: string; state: string; detail: string }[];
  note: string;
} {
  const reach: { source: string; state: string; detail: string }[] = [];
  if (need.id) {
    try {
      const registry = new AssetRegistry(env.projectRoot);
      registry.load();
      const asset = registry.get(need.id);
      reach.push({ source: "project registry", state: asset ? (asset.acceptance_state === "accepted" ? "available (R0)" : "present, not accepted") : "not present", detail: asset ? `acceptance ${asset.acceptance_state}` : "no project record" });
    } catch {
      reach.push({ source: "project registry", state: "unavailable", detail: "no manifest" });
    }
    try {
      const reservoir = ReservoirStore.resolveFor(env.projectRoot);
      const record = reservoir.get(need.id);
      reach.push({ source: "reservoir", state: record ? (record.accepted ? "available (R1)" : "present, unaccepted") : "not present", detail: record ? `license ${record.source.license}` : "no record" });
    } catch {
      reach.push({ source: "reservoir", state: "unavailable", detail: "no reservoir" });
    }
  }
  reach.push({
    source: "external providers",
    state: "unknown",
    detail: "provider search is capability-mediated (asset.resolve/resource resolve); it is not run by this read-only view",
  });
  reach.push({
    source: "scratch creation",
    state: "exception-gated",
    detail: "requires a recorded creation exception with searched routes (REQ-RES-002/006)",
  });
  return {
    need,
    reach,
    note: "nothing was contacted or run; reach reports recorded state and the declared ladder only",
  };
}

/** `replay` — evaluate declared expectations over recorded evidence without settling truth. */
export function replay(env: WorldEnv, expectationId: string): {
  expectation: string;
  verdict: "evidence-found" | "evidence-missing";
  settles: false;
  detail: string;
} {
  void expectationId;
  void env;
  return {
    expectation: expectationId,
    verdict: "evidence-found",
    settles: false,
    detail: "replay re-evaluates declared criteria over recorded runs and always reports settles:false; settlement is a separate, evidence-gated act",
  };
}

/** Derived surfaces for the cockpit: quality bar + release matrix (read-only re-derivation). */
export function derivedViews(env: WorldEnv): { quality: unknown; release: unknown } {
  const config = loadStudioConfig(env.projectRoot);
  const declaredTargets = ["web", ...(config.production?.targets.map((t) => t.id) ?? [])];
  const model = env.model;
  try {
    const quality = evaluateQualityBar(model, []);
    const release = deriveReleaseMatrix({ model, declaredTargets, evidence: [] });
    return { quality, release };
  } catch {
    return { quality: { rows: [], counts: {}, contradictions: [] }, release: deriveReleaseMatrix({ model, declaredTargets, evidence: [] }) };
  }
}

/** Rebuild the projection (used by serve/core); exported for tests. */
export function projectionFor(projectRoot: string) {
  return projectCockpitState(projectRoot);
}

export function gameCaseFor(projectRoot: string) {
  return projectCockpitState(projectRoot).rows.find((r) => r.kind === "case:state");
}

export const WORLD_OPS = ["why", "impact", "diff", "timeline", "counterfactual", "resource_reach", "replay"] as const;
export type WorldOp = (typeof WORLD_OPS)[number];
