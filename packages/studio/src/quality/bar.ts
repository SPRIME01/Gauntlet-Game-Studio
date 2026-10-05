/**
 * Professional quality bar (REQ-QUAL-001..002, spec v0.5.0) and the derived
 * target-by-target release matrix (REQ-RELEASE-001..003, spec v0.5.0).
 *
 * Quality criteria are declared in the Game Model; their states are derived
 * from evidence with the rule that a pass MUST cite real evidence, unknown
 * stays unknown, and not-applicable must be declared with reason. There is no
 * numeric score, no percentage, and no composite quality index anywhere in
 * this module — by explicit normative requirement.
 *
 * The release matrix derives per-target settlement. Each target settles
 * independently: one target passing never settles another, and
 * software-rendered or otherwise non-target evidence cannot settle a
 * hardware-bound profile.
 */

import type { GameModel } from "../model/model";

export const QUALITY_DIMENSIONS = [
  "player-feel",
  "visual",
  "world",
  "audio",
  "ux",
  "technical",
  "release",
] as const;

export type QualityDimension = (typeof QUALITY_DIMENSIONS)[number];

export type QualityState = "pass" | "attention" | "fail" | "unknown" | "not-applicable";

export interface QualityEvidenceRow {
  /** Settlement/manifest id the evidence came from. */
  id: string;
  /** Requirement ids the evidence was settled against. */
  requirement_ids: string[];
  decision: "settled" | "blocked" | "failed" | "incomplete";
  result?: "pass" | "fail" | "blocked" | "incomplete";
  /** Environment/renderer class when known (e.g. "swiftshader" = non-target). */
  environment?: Record<string, unknown>;
  stale?: boolean;
  contradictions?: string[];
}

export interface QualityCriterionRow {
  criterion_id: string;
  dimension: QualityDimension;
  requirement: string;
  state: QualityState;
  /** Evidence ids backing the state (a pass always has at least one). */
  evidence: string[];
  reason?: string;
  target?: string;
}

export interface QualityBarEvaluation {
  rows: QualityCriterionRow[];
  counts: Record<QualityState, number>;
  contradictions: string[];
}

export type QualityBarErrorCode =
  | "QUALITY_BAR_NOT_DECLARED"
  | "QUALITY_STATE_WITHOUT_EVIDENCE";

export class QualityBarError extends Error {
  constructor(
    readonly code: QualityBarErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "QualityBarError";
  }
}

const NON_TARGET_RENDERERS = /swiftshader|software|llvmpipe|angle \(software/i;

function evidenceSupportsPass(row: QualityEvidenceRow): boolean {
  return row.decision === "settled" && (row.result === undefined || row.result === "pass") && !row.stale;
}

function evidenceShowsFailure(row: QualityEvidenceRow): boolean {
  return row.decision === "failed" || row.result === "fail";
}

/** Non-target renderer evidence cannot settle a hardware-bound claim (REQ-RELEASE-003). */
export function isNonTargetEvidence(row: QualityEvidenceRow): boolean {
  const renderer = String(row.environment?.renderer ?? row.environment?.RENDERER ?? "");
  return NON_TARGET_RENDERERS.test(renderer);
}

/**
 * Evaluate the declared quality bar against evidence. Pure. A pass is only
 * ever derived from real, fresh, non-contradicted evidence; unknown stays
 * unknown; a criterion without a linked-evidence path can never emit pass.
 */
export function evaluateQualityBar(
  model: GameModel,
  evidence: QualityEvidenceRow[],
): QualityBarEvaluation {
  const criteria = model.known.quality_bar?.criteria;
  if (!criteria || criteria.length === 0) {
    throw new QualityBarError(
      "QUALITY_BAR_NOT_DECLARED",
      `${model.path}: the Game Model declares no quality_bar criteria — quality is unknown, not assumed`,
    );
  }

  const contradictions = [
    ...(model.known.contradictions ?? []).map((c) => c.text),
    ...evidence.flatMap((e) => e.contradictions ?? []),
  ];

  const rows: QualityCriterionRow[] = criteria.map((criterion) => {
    if (criterion.not_applicable_reason !== undefined) {
      return {
        criterion_id: criterion.id,
        dimension: criterion.dimension,
        requirement: criterion.requirement,
        state: "not-applicable",
        evidence: [],
        reason: criterion.not_applicable_reason,
        ...(criterion.target ? { target: criterion.target } : {}),
      };
    }

    // Evidence linkage is by explicit evidence_refs (settlement/manifest ids).
    const linked = evidence.filter((e) => criterion.evidence_refs.includes(e.id));
    const passEvidence = linked.filter(evidenceSupportsPass);
    const failEvidence = linked.filter(evidenceShowsFailure);
    const staleEvidence = linked.filter((e) => e.stale);
    const contradicted = linked.filter(
      (e) => (e.contradictions?.length ?? 0) > 0 || contradictions.some((c) => c.includes(criterion.id)),
    );

    if (failEvidence.length > 0) {
      return row(criterion, "fail", failEvidence.map((e) => e.id), "evidence shows the criterion failing");
    }
    if (contradicted.length > 0) {
      return row(criterion, "attention", contradicted.map((e) => e.id), "linked evidence carries contradictions; review before progress");
    }
    if (passEvidence.length > 0) {
      return row(criterion, "pass", passEvidence.map((e) => e.id));
    }
    if (staleEvidence.length > 0) {
      return row(criterion, "attention", staleEvidence.map((e) => e.id), "linked evidence is stale against the current model; re-derive");
    }
    if (linked.length > 0) {
      return row(criterion, "attention", linked.map((e) => e.id), "linked evidence is not settled (blocked or incomplete)");
    }
    return row(criterion, "unknown", [], "no linked evidence; unknown stays unknown");
  });

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.state] += 1;
      return acc;
    },
    { pass: 0, attention: 0, fail: 0, unknown: 0, "not-applicable": 0 } as Record<QualityState, number>,
  );

  return { rows, counts, contradictions };
}

function row(
  criterion: { id: string; dimension: QualityDimension; requirement: string; target?: string },
  state: QualityState,
  evidence: string[],
  reason?: string,
): QualityCriterionRow {
  return {
    criterion_id: criterion.id,
    dimension: criterion.dimension,
    requirement: criterion.requirement,
    state,
    evidence,
    ...(reason ? { reason } : {}),
    ...(criterion.target ? { target: criterion.target } : {}),
  };
}

// ── Release matrix (REQ-RELEASE-001..003) ──────────────────────────────────

export const RELEASE_DIMENSIONS = [
  "build",
  "core-loop",
  "scenarios",
  "visual-quality",
  "animation",
  "audio",
  "ui-ux",
  "performance",
  "input",
  "save-resume",
  "startup",
  "crash-error-state",
  "packaging",
  "signing",
  "platform-specific",
] as const;

export type ReleaseDimension = (typeof RELEASE_DIMENSIONS)[number];

export type ReleaseDimensionState = "pass" | "fail" | "unknown" | "blocked" | "not-applicable";

export interface ReleaseEvidenceRow extends QualityEvidenceRow {
  target: string;
  dimension: ReleaseDimension;
  /** Set when the evidence came from a non-target environment (e.g. SwiftShader). */
  non_target?: boolean;
}

export interface ReleaseDimensionRow {
  dimension: ReleaseDimension;
  state: ReleaseDimensionState;
  evidence: string[];
  reason?: string;
}

export interface ReleaseTargetRow {
  target: string;
  declared: boolean;
  dimensions: ReleaseDimensionRow[];
  /** Independent per-target settlement: this target's own state, nothing inherited. */
  settlement: "settled" | "blocked" | "unsettled";
}

export interface ReleaseMatrix {
  targets: ReleaseTargetRow[];
  note: string;
}

export interface ReleaseMatrixInput {
  model: GameModel;
  /** Production targets declared in studio config (godot.web etc.); web included when declared. */
  declaredTargets: string[];
  evidence: ReleaseEvidenceRow[];
}

/**
 * Derive the target-by-target release matrix. Pure. Per-target settlement is
 * independent: evidence rows are matched by target AND dimension, and a
 * dimension only settles from evidence whose target matches exactly.
 */
export function deriveReleaseMatrix(input: ReleaseMatrixInput): ReleaseMatrix {
  const declaredReqs = input.model.known.release?.requirements ?? {};
  const allTargets = new Set<string>([...input.declaredTargets, ...Object.keys(declaredReqs)]);

  const targets: ReleaseTargetRow[] = [...allTargets].sort().map((target) => {
    const declared = Object.prototype.hasOwnProperty.call(declaredReqs, target);
    const targetEvidence = input.evidence.filter((e) => e.target === target);
    const naDimensions = new Set(
      (declaredReqs[target] ?? [])
        .filter((r) => r.startsWith("not-applicable:"))
        .map((r) => r.slice("not-applicable:".length)),
    );

    const dimensions: ReleaseDimensionRow[] = RELEASE_DIMENSIONS.map((dimension) => {
      if (naDimensions.has(dimension)) {
        return { dimension, state: "not-applicable", evidence: [], reason: "declared not applicable for this target" };
      }
      const dimEvidence = targetEvidence.filter((e) => e.dimension === dimension);
      if (dimEvidence.length === 0) {
        return { dimension, state: "unknown", evidence: [] };
      }
      const nonTarget = dimEvidence.filter((e) => e.non_target || isNonTargetEvidence(e));
      const failures = dimEvidence.filter(evidenceShowsFailure);
      // Non-target evidence can never contribute a pass: it is not evidence
      // about this target (REQ-RELEASE-003).
      const passes = dimEvidence.filter((e) => evidenceSupportsPass(e) && !(e.non_target || isNonTargetEvidence(e)));
      if (nonTarget.length > 0 && passes.length === 0 && failures.length === 0) {
        return {
          dimension,
          state: "blocked",
          evidence: nonTarget.map((e) => e.id),
          reason: "only non-target (e.g. software-rendered) evidence exists; it cannot settle a hardware-bound target",
        };
      }
      if (failures.length > 0) {
        return { dimension, state: "fail", evidence: failures.map((e) => e.id) };
      }
      if (passes.length > 0) {
        return { dimension, state: "pass", evidence: passes.map((e) => e.id) };
      }
      return { dimension, state: "unknown", evidence: dimEvidence.map((e) => e.id) };
    });

    const settling = dimensions.filter((d) => d.state === "pass" || d.state === "not-applicable");
    const failing = dimensions.filter((d) => d.state === "fail");
    const settlement: ReleaseTargetRow["settlement"] =
      failing.length > 0 ? "unsettled" : settling.length === dimensions.length ? "settled" : "unsettled";

    return { target, declared, dimensions, settlement };
  });

  return {
    targets,
    note: "derived, read-only, per-target: one target passing never settles another; software-rendered evidence cannot settle a hardware-bound target",
  };
}
