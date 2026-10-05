/**
 * Release rail derivation (REQ-COCKPIT-002, spec v0.5.0).
 *
 * The rail's thirteen fields are DERIVED from canonical state — the same pure
 * helpers the Game Case uses — and served read-only to the shell. The rail is
 * rendered by the shell, never by an agent surface; it contains no percentage
 * completion, no decorative KPIs, and no quality score. The release verdict
 * field is always the owner's: this derivation reports settlement state, it
 * never decides release.
 */

import { join } from "node:path";
import {
  loadGameModel,
  loadStudioConfig,
  collectDerivativeStamps,
  evaluateProjectStaleness,
  evaluateQualityBar,
  deriveReleaseMatrix,
  deriveGameCase,
  type QualityEvidenceRow,
} from "@gauntlet/studio";
import { existsSync, readdirSync, readFileSync } from "node:fs";

export interface ReleaseRail {
  game: { title: string; game_id: string };
  model_version: number;
  phase: "orient" | "build" | "verify" | "release";
  milestone: string;
  target_platforms: { target: string; settlement: string }[];
  quality_profiles: { declared: string[]; production_bound: string[] };
  contradictions: number;
  unknowns: number;
  stale_derivatives: number;
  blockers: number;
  owner_input: { open_asks: number; ready_for_review: number; owner_moves: number };
  next_move: { id: string; label: string; why: string } | null;
  release_verdict: string;
  derived_from: string[];
}

function collectEvidenceRows(projectRoot: string): QualityEvidenceRow[] {
  const rows: QualityEvidenceRow[] = [];
  const runsDir = join(projectRoot, "artifacts", "runs");
  if (!existsSync(runsDir)) return rows;
  for (const entry of readdirSync(runsDir)) {
    const runDir = join(runsDir, entry);
    if (!isDir(runDir)) continue;
    for (const file of readdirSync(runDir).filter((f) => f.startsWith("settlement-") && f.endsWith(".json"))) {
      try {
        const body = JSON.parse(readFileSync(join(runDir, file), "utf8")) as Record<string, unknown>;
        rows.push({
          id: String(body.id ?? file),
          requirement_ids: Array.isArray(body.requirement_ids) ? (body.requirement_ids as string[]) : [],
          decision: (body.decision as QualityEvidenceRow["decision"]) ?? "incomplete",
        });
      } catch {
        /* unreadable settlement cannot settle anything */
      }
    }
  }
  return rows;
}

function isDir(dir: string): boolean {
  try {
    if (!existsSync(dir)) return false;
    readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive the release rail. Pure over canonical files; the same project state
 * always yields the same rail.
 */
export function deriveRail(projectRoot: string, opts: { openAsks?: number; readyForReview?: number } = {}): ReleaseRail {
  const root = projectRoot.replace(/\/$/, "");
  const model = loadGameModel(join(root, ".agents", "specs", "game.spec.yaml"));
  const evidence = collectEvidenceRows(root);
  const staleness = evaluateProjectStaleness(model, collectDerivativeStamps(root));

  let quality: ReturnType<typeof evaluateQualityBar> | null = null;
  let release: ReturnType<typeof deriveReleaseMatrix> | null = null;
  try {
    quality = evaluateQualityBar(model, evidence);
    const config = loadStudioConfig(root);
    const declaredTargets = ["web", ...(config.production?.targets.map((t) => t.id) ?? [])];
    release = deriveReleaseMatrix({ model, declaredTargets, evidence: [] });
  } catch {
    /* no declared quality bar: quality stays unknown; release matrix still derives */
    try {
      const config = loadStudioConfig(root);
      const declaredTargets = ["web", ...(config.production?.targets.map((t) => t.id) ?? [])];
      release = deriveReleaseMatrix({ model, declaredTargets, evidence: [] });
    } catch {
      release = null;
    }
  }

  const gameCase = deriveGameCase({
    model,
    staleness,
    quality:
      quality ??
      { rows: [], counts: { pass: 0, attention: 0, fail: 0, unknown: 0, "not-applicable": 0 }, contradictions: [] },
    release: release ?? { targets: [], note: "" },
  });

  const failing = release?.targets.flatMap((t) => t.dimensions).filter((d) => d.state === "fail").length ?? 0;
  const settledTargets = release?.targets.filter((t) => t.settlement === "settled").length ?? 0;
  const totalTargets = release?.targets.length ?? 0;

  // Phase is derived, coarse, and honest: release when every declared target
  // settled, build while anything fails, verify while evidence is missing,
  // orient when nothing is declared enough to measure.
  const phase: ReleaseRail["phase"] =
    totalTargets > 0 && settledTargets === totalTargets
      ? "release"
      : failing > 0 || gameCase.deviations.some((d) => d.kind === "contradiction")
        ? "build"
        : totalTargets > 0
          ? "verify"
          : "orient";

  const milestone =
    totalTargets > 0
      ? settledTargets === totalTargets
        ? "all declared targets settled"
        : `next: ${release?.targets.find((t) => t.settlement !== "settled")?.target ?? "settled"}`
      : `model@${model.modelVersion}`;

  const productionBound = Array.from(
    new Set(
      (loadStudioConfigSafe(root).production?.targets ?? [])
        .map((t) => t.quality_profile)
        .filter((p): p is string => Boolean(p)),
    ),
  );

  const primary = gameCase.primary_move;

  return {
    game: {
      title: model.known.identity?.title ?? model.known.identity?.game_id ?? "unknown game",
      game_id: model.known.identity?.game_id ?? "unknown",
    },
    model_version: model.modelVersion,
    phase,
    milestone,
    target_platforms:
      release?.targets.map((t) => ({ target: t.target, settlement: t.settlement })) ?? [],
    quality_profiles: {
      declared: Object.keys(model.qualityProfiles),
      production_bound: productionBound,
    },
    contradictions:
      (model.known.contradictions?.length ?? 0) + (quality?.contradictions.length ?? 0),
    unknowns: (model.known.unknowns ?? []).filter((u) => u.status === "open").length,
    stale_derivatives: staleness.filter((s) => s.stale).length,
    blockers: gameCase.deviations.filter((d) => d.severity === "interrupt").length,
    owner_input: {
      open_asks: opts.openAsks ?? 0,
      ready_for_review: opts.readyForReview ?? 0,
      owner_moves: gameCase.alternatives.concat(gameCase.primary_move ? [gameCase.primary_move] : [])
        .filter((m) => m.authority === "owner-review-required" || m.authority === "owner").length,
    },
    next_move: primary ? { id: primary.id, label: primary.label, why: primary.why } : null,
    release_verdict: `owner-settled (${settledTargets}/${totalTargets} declared targets settled)`,
    derived_from: [model.path, "release matrix", "quality bar", "game case", "staleness report"],
  };
}

function loadStudioConfigSafe(root: string): { production?: { targets: { id: string; quality_profile?: string }[] } } {
  try {
    return loadStudioConfig(root) as { production?: { targets: { id: string; quality_profile?: string }[] } };
  } catch {
    return {};
  }
}
