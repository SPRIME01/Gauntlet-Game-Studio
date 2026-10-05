/**
 * Projection of canonical project state into the disposable cockpit store
 * (REQ-COCKPIT-003). Pure with respect to the project: same files in, same
 * rows out. The cockpit reads the Game Model, asset registry, recipes,
 * reservoir, evidence, and the derived staleness/quality/release/Game Case
 * views through the studio modules — it never becomes a second authority and
 * it writes nothing back to canonical state.
 */

import { join } from "node:path";
import { loadGameModel, collectDerivativeStamps, evaluateProjectStaleness } from "@gauntlet/studio";
import { evaluateQualityBar, deriveReleaseMatrix } from "@gauntlet/studio";
import { deriveGameCase } from "@gauntlet/studio";
import { loadStudioConfig } from "@gauntlet/studio";
import { AssetRegistry } from "@gauntlet/studio";
import { ReservoirStore } from "@gauntlet/studio";
import type { ProjectionRow } from "./db";

export interface ProjectedCockpitState {
  rows: ProjectionRow[];
  searchRows: { kind: string; id: string; text: string }[];
}

function row(kind: string, id: string, ord: number, data: unknown): ProjectionRow {
  return { kind, id, ord, data: JSON.stringify(data) };
}

function searchText(data: unknown): string {
  return JSON.stringify(data).replace(/["{}[\],:]/g, " ").replace(/\s+/g, " ").slice(0, 400);
}

/**
 * Project the canonical state of the game at projectRoot. Deterministic:
 * identical canonical files produce identical rows (proven by the rebuild
 * equality test). Canonical files are read read-only.
 */
export function projectCockpitState(projectRoot: string, opts: { workRequests?: unknown[] } = {}): ProjectedCockpitState {
  const rows: ProjectionRow[] = [];
  const searchRows: { kind: string; id: string; text: string }[] = [];
  const push = (kind: string, id: string, ord: number, data: unknown) => {
    rows.push(row(kind, id, ord, data));
    searchRows.push({ kind, id, text: searchText(data) });
  };

  const model = loadGameModel(join(projectRoot, ".agents", "specs", "game.spec.yaml"));
  push("gm:identity", "identity", 0, { model_version: model.modelVersion, ...model.known.identity });
  push("gm:model", "model", 0, {
    model_version: model.modelVersion,
    identity: model.known.identity,
    fantasy: model.known.fantasy,
    genre: model.known.genre,
    audience: model.known.audience,
    pillars: model.known.pillars,
    core_loop: model.known.core_loop,
    secondary_loops: model.known.secondary_loops,
    camera: model.known.camera,
    controls: model.known.controls,
    languages: model.known.languages,
    platforms: model.known.platforms,
    release: model.known.release,
    extensions: Object.keys(model.extensions),
    legacy_sections: model.legacySections,
  });
  (model.known.decisions ?? []).forEach((d, i) => push("gm:decision", `decision-${d.n}`, i, d));
  (model.known.contradictions ?? []).forEach((c, i) => push("gm:contradiction", c.id, i, c));
  (model.known.unknowns ?? []).forEach((u, i) => push("gm:unknown", u.id, i, u));
  (model.known.north_star?.references ?? []).forEach((r, i) => push("gm:north-star", r.id, i, r));
  (model.known.entities ?? []).forEach((e, i) => push("gm:entity", e.id, i, e));
  Object.entries(model.known.scenarios ?? {}).forEach(([id, s], i) => push("gm:scenario", id, i, s));

  // Quality bar + release matrix + game case (derived, read-only).
  try {
    const evidenceRows = collectSettlementEvidence(projectRoot);
    const quality = evaluateQualityBar(model, evidenceRows);
    quality.rows.forEach((r, i) => push("quality:criterion", r.criterion_id, i, r));
    const config = loadStudioConfig(projectRoot);
    const declaredTargets = ["web", ...(config.production?.targets.map((t) => t.id) ?? [])];
    const release = deriveReleaseMatrix({ model, declaredTargets, evidence: [] });
    release.targets.forEach((t, i) => push("release:target", t.target, i, t));
    const staleness = evaluateProjectStaleness(model, collectDerivativeStamps(projectRoot));
    const gameCase = deriveGameCase({ model, staleness, quality, release });
    push("case:state", "current", 0, gameCase);
  } catch {
    // A project without a declared quality bar still projects; the Game Case
    // records quality as unknown rather than assuming it.
    const staleness = evaluateProjectStaleness(model, collectDerivativeStamps(projectRoot));
    push("case:state", "current", 0, {
      ok: true,
      authoritative: false,
      destination: { text: model.known.identity?.title ?? model.known.identity?.game_id ?? "unknown", release_bar: "no quality bar declared — release bar undefined", declared_by: "Game Model" },
      current: `model@${model.modelVersion}; quality bar not declared`,
      deviations: staleness.filter((s) => s.stale).map((s) => ({ key: `stale:${s.id}`, kind: "stale-derivative", severity: "salient", text: `${s.id} stale against model@${model.modelVersion}` })),
      material: null,
      primary_move: null,
      alternatives: [],
      blocked: [],
      settlement: { reachable: false, note: "quality bar not declared; the release verdict is the owner's" },
      counts: { deviations: 0, available: 0, blocked: 0 },
    });
  }

  // Asset registry.
  try {
    const registry = new AssetRegistry(projectRoot);
    registry.load();
    registry.records.forEach((r, i) =>
      push("resources:asset", r.id, i, {
        id: r.id,
        role: r.role,
        origin: r.origin,
        acceptance_state: r.acceptance_state,
        source_provenance: r.source_provenance,
        built_from: r.built_from,
        reads: r.reads,
      }),
    );
  } catch {
    /* no manifest yet */
  }

  // Reservoir.
  try {
    const reservoir = ReservoirStore.resolveFor(projectRoot);
    reservoir.records().forEach((r, i) => push("reservoir:record", r.id, i, { ...r, local_hash: r.local_hash.slice(0, 12) }));
  } catch {
    /* no reservoir yet */
  }

  // Work requests (cockpit state, projected for display).
  (opts.workRequests ?? []).forEach((w, i) => push("work:request", `request-${i}`, i, w));

  return { rows, searchRows };
}

function collectSettlementEvidence(projectRoot: string) {
  const rows: { id: string; requirement_ids: string[]; decision: "settled" | "blocked" | "failed" | "incomplete"; result?: "pass" | "fail" | "blocked" | "incomplete"; stale?: boolean }[] = [];
  const runsDir = join(projectRoot, "artifacts", "runs");
  if (!require("node:fs").existsSync(runsDir)) return rows;
  const fs = require("node:fs");
  for (const entry of fs.readdirSync(runsDir)) {
    const runDir = join(runsDir, entry);
    if (!fs.statSync(runDir).isDirectory()) continue;
    for (const file of fs.readdirSync(runDir).filter((f: string) => f.startsWith("settlement-") && f.endsWith(".json"))) {
      try {
        const body = JSON.parse(fs.readFileSync(join(runDir, file), "utf8"));
        rows.push({
          id: String(body.id ?? file),
          requirement_ids: Array.isArray(body.requirement_ids) ? body.requirement_ids : [],
          decision: body.decision ?? "incomplete",
        });
      } catch {
        /* unreadable settlement cannot settle anything */
      }
    }
  }
  return rows;
}
