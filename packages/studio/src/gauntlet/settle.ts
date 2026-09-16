/**
 * Gauntlet settlement bridge (T20, REQ-GAUNTLET-001..006, REQ-VERIFY-001/002/005).
 *
 * Compares a FROZEN expectation against observed channel evidence and produces a
 * SettlementRecord classified settled | blocked | failed | incomplete.
 *
 * Decision discipline (verify_observation pseudocode in the spec):
 *   - missing or stale required channel evidence  -> incomplete
 *   - required browser proof unavailable          -> blocked   (RECOV-004; never passed)
 *   - any required channel check fails            -> failed (+ blockage classification,
 *                                                    + cross-channel contradiction record)
 *   - all pass but required confirmation missing  -> incomplete (confirmation gate)
 *   - all pass, fresh, confirmation satisfied     -> settled
 *
 * Provider/build success is structurally NOT an input: settlement reads only the
 * observed channel evidence and its identity (run/revision freshness). A correct
 * screenshot can never override a semantic contradiction (REQ-VERIFY-001): state is
 * authoritative game truth; pixels are a consequence, not an authority.
 */

import {
  SettlementRecordSchema,
  type EvidenceManifest,
  type ObservationRun,
  type SettlementRecord,
} from "@gauntlet/contracts";
import type { BudgetErrorSummary } from "@gauntlet/contracts";
import type { ChannelEvidence, PerformanceChannelEvidence } from "@gauntlet/adapters";
import { CURRENT_REVISION_SENTINEL, type FrozenExpectation } from "./expectation";
import { evaluateClaimedChannels, type ChannelVerdict } from "./checks";
import { evaluatePerformanceEvidence, type AssetBudgetSummary } from "../quality/evaluate";
import type { ResolvedQualityProfile } from "../quality/profiles";

export type SettlementDecision = "settled" | "blocked" | "failed" | "incomplete";

/** REQ-GAUNTLET-004 blockage classification vocabulary. */
export type BlockageClass =
  | "evidence_missing"
  | "evidence_stale"
  | "evidence_uncorrelated"
  | "browser_proof_unavailable"
  | "evidence_channel_missing"
  | "confirmation_required"
  | "insufficiently_represented"
  | "represented_but_deficient"
  | "visual_consequence_deficit"
  | "runtime_consequence_deficit"
  | "network_consequence_deficit"
  | "hardware_target_unavailable";

export interface SettlementAvailability {
  /** Whether required browser proof COULD run in this environment. */
  browser_proof_available: boolean;
  unavailable_reason?: string;
}

/** Declared performance gate resolution for performance claims (T21). */
export interface SettlementPerformanceInput {
  /** The quality profile RESOLVED from the game project (declared before use). */
  profile: ResolvedQualityProfile;
  /** Optional T13 Asset Registry summary feeding structural asset budgets. */
  asset_summary?: AssetBudgetSummary | null;
}

export interface SettlementInput {
  expectation: FrozenExpectation;
  run: ObservationRun | null;
  manifests: EvidenceManifest[];
  channels: ChannelEvidence[];
  availability: SettlementAvailability;
  /** The authoritative current project revision (freshness identity). */
  currentRevision: string;
  confirmation?: { mode: string; ref: string };
  /** Declared performance gate (T21) when the expectation claims the channel. */
  performance?: SettlementPerformanceInput | null;
  /** Deterministic clock override for fixture generation. */
  now?: string;
}

export interface SettlementOutcome {
  decision: SettlementDecision;
  blockage_class?: BlockageClass;
  reason: string;
  contradictions: string[];
  channel_verdicts: ChannelVerdict[];
  /** JSON-safe budget_error projection when a declared budget was violated (T21). */
  budget_error?: BudgetErrorSummary;
  /** Null only when no manifest exists to cite (SettlementRecord requires evidence). */
  record: SettlementRecord | null;
}

function classifySemanticFailure(verdict: ChannelVerdict): BlockageClass {
  if (verdict.checks.some((c) => c.code === "SEMANTIC_ENTITY_MISSING")) {
    return "insufficiently_represented";
  }
  return "represented_but_deficient";
}

function buildContradictions(verdicts: ChannelVerdict[]): string[] {
  const contradictions: string[] = [];
  const verdict = (ch: string) => verdicts.find((v) => v.channel === ch);
  const state = verdict("state");
  const pixels = verdict("pixels");
  const telemetry = verdict("telemetry");
  const network = verdict("network");

  if (state && pixels && state.evaluated && pixels.evaluated && !state.pass && pixels.pass) {
    contradictions.push(
      "pixels_pass_state_fail: rendered captures satisfy visual constraints while the authoritative " +
        "semantic state violates the frozen expectation; pixels cannot override a semantic contradiction"
    );
  }
  if (state && pixels && state.evaluated && pixels.evaluated && state.pass && !pixels.pass) {
    contradictions.push(
      "state_pass_pixels_fail: semantic state satisfies constraints while rendered captures violate " +
        "visual constraints; visible consequence is missing"
    );
  }
  if (
    telemetry &&
    telemetry.evaluated &&
    !telemetry.pass &&
    state?.evaluated &&
    pixels?.evaluated &&
    state.pass &&
    pixels.pass
  ) {
    contradictions.push(
      "telemetry_contradiction: runtime consequence (console/tick) contradicts passing state and pixel channels"
    );
  }
  if (
    network &&
    network.evaluated &&
    !network.pass &&
    state?.evaluated &&
    pixels?.evaluated &&
    state.pass &&
    pixels.pass
  ) {
    contradictions.push(
      "network_contradiction: network evidence contradicts passing state and pixel channels"
    );
  }
  const performance = verdicts.find((v) => v.channel === "performance");
  if (
    performance &&
    performance.evaluated &&
    !performance.pass &&
    state?.evaluated &&
    pixels?.evaluated &&
    state.pass &&
    pixels.pass
  ) {
    contradictions.push(
      "performance_contradiction: rendered captures and authoritative semantic state satisfy their " +
        "constraints while a declared runtime-profile budget is violated; visual or semantic success " +
        "cannot settle a performance requirement (REQ-PERF-004)"
    );
  }
  return contradictions;
}

function nextAffordanceFor(decision: SettlementDecision, blockage?: BlockageClass): string | undefined {
  switch (blockage) {
    case "browser_proof_unavailable":
      return "restore browser proof availability (Playwright + system Chrome) and re-run a fresh observation";
    case "evidence_stale":
    case "evidence_uncorrelated":
      return "record a fresh ObservationRun bound to the current project revision";
    case "evidence_channel_missing":
      return "re-run the observation so all claimed channels are captured";
    case "confirmation_required":
      return "obtain the declared confirmation mode before settlement";
    case "insufficiently_represented":
    case "represented_but_deficient":
    case "visual_consequence_deficit":
    case "runtime_consequence_deficit":
    case "network_consequence_deficit":
      return "apply a bounded, evidence-producing correction; preserve the failed evidence";
    case "hardware_target_unavailable":
      return "re-run on the declared target environment for the profile, or bind an explicitly declared relative-baseline profile; software-rendered evidence is non-target and can never settle a hardware-target profile";
    default:
      return undefined;
  }
}

/**
 * Pure settlement comparison: frozen expectation vs observed evidence.
 * Never runs anything; never trusts provider/build success (no such input exists).
 */
export function settleExpectation(input: SettlementInput): SettlementOutcome {
  const { expectation, run, manifests, channels, availability, currentRevision } = input;
  const now = input.now ?? new Date().toISOString();
  const manifestIds = manifests.map((m) => m.id);
  const base = {
    expectation,
    run,
    manifests,
    channels,
    availability,
    currentRevision,
  };

  // 1. No evidence at all -> incomplete (cannot even cite a manifest).
  if (!run || manifests.length === 0) {
    return {
      decision: "incomplete",
      blockage_class: "evidence_missing",
      reason:
        "no ObservationRun/EvidenceManifest pair was available for the claimed channels; " +
        "settlement requires evidence, not provider or build success",
      contradictions: [],
      channel_verdicts: [],
      record: null,
    };
  }

  // A blocked observation (e.g. Playwright/Chrome unavailable) can never settle —
  // and a pixels claim without an available browser proof is blocked, never passed
  // (RECOV-004, TEETH-T20-003).
  const observationBlocked = manifests.some((m) => m.result === "blocked");
  if (expectation.claims.pixels && (!availability.browser_proof_available || observationBlocked)) {
    const why =
      availability.unavailable_reason ?? "browser proof observation reported a typed blockage";
    return {
      decision: "blocked",
      blockage_class: "browser_proof_unavailable",
      reason: `required browser proof is unavailable (${why}); the requirement is blocked, never passed`,
      contradictions: [],
      channel_verdicts: [],
      record: buildRecord(expectation, run, manifestIds, {
        decision: "blocked",
        blockage_class: "browser_proof_unavailable",
        reason: `required browser proof is unavailable (${why}); blocked, never passed`,
        now,
      }),
    };
  }

  // 2. Freshness/correlation from run/revision IDENTITY (REQ-GAUNTLET-006).
  const expectedRevision =
    expectation.revision === CURRENT_REVISION_SENTINEL ? currentRevision : expectation.revision;
  if (expectedRevision !== currentRevision) {
    return staleOutcome(
      base,
      `frozen expectation '${expectation.id}' is bound to revision '${expectation.revision}' while the current revision is '${currentRevision}'; verification for a changed game revision requires fresh runs`
    );
  }
  if (run.project_revision !== currentRevision) {
    return staleOutcome(base, `observation run '${run.id}' belongs to revision '${run.project_revision}', not the current revision '${currentRevision}'`);
  }
  for (const manifest of manifests) {
    if (manifest.project_revision !== currentRevision) {
      return staleOutcome(
        base,
        `evidence manifest '${manifest.id}' belongs to project revision '${manifest.project_revision}', not the current revision '${currentRevision}'`
      );
    }
    if (manifest.run_id !== run.id) {
      return {
        decision: "incomplete",
        blockage_class: "evidence_uncorrelated",
        reason: `manifest '${manifest.id}' does not correlate to run '${run.id}'; observations from different historical runs must not be merged`,
        contradictions: [],
        channel_verdicts: [],
        record: buildRecord(expectation, run, manifestIds, {
          decision: "incomplete",
          blockage_class: "evidence_uncorrelated",
          reason: `manifest '${manifest.id}' uncorrelated with run '${run.id}'`,
          now,
        }),
      };
    }
  }

  // 3. Channel selection + evaluation (REQ-GAUNTLET-003). Performance claims (T21)
  // evaluate against the game-project-declared quality profile.
  const verdicts = evaluateClaimedChannels(expectation, channels, {
    performance: input.performance ?? null,
  });

  // 4. Missing required channel evidence -> incomplete.
  for (const v of verdicts) {
    if (!v.evaluated) {
      return {
        decision: "incomplete",
        blockage_class: "evidence_channel_missing",
        reason: `required channel '${v.channel}' has no observed evidence in run '${run.id}'; incomplete, never passed`,
        contradictions: [],
        channel_verdicts: verdicts,
        record: buildRecord(expectation, run, manifestIds, {
          decision: "incomplete",
          blockage_class: "evidence_channel_missing",
          reason: `required channel '${v.channel}' was not observed in run '${run.id}'`,
          now,
        }),
      };
    }
  }

  const contradictions = buildContradictions(verdicts);
  const failed = verdicts.filter((v) => !v.pass);

  // 5. Any required check fails -> failed, with REQ-GAUNTLET-004 classification.
  if (failed.length > 0) {
    const perfV = verdicts.find((v) => v.channel === "performance" && v.evaluated && !v.pass);
    if (perfV && input.performance) {
      // T21: performance failures map through the declared quality profile.
      const perfEvidence =
        (channels.find((c) => c.channel === "performance") as PerformanceChannelEvidence | undefined) ?? null;
      const evaluation = evaluatePerformanceEvidence(
        input.performance.profile,
        perfEvidence ??
          ({
            channel: "performance",
            quality_profile: input.performance.profile.id,
            present: false,
            reason: "performance channel evidence missing",
            metrics: {},
            unreported: [],
            renderer_class: "unknown",
            read_via: [],
          } satisfies PerformanceChannelEvidence),
        input.performance.asset_summary ?? null
      );
      const nonTargetOnly =
        evaluation.non_target && !evaluation.structural_failed && !evaluation.hardware_failed;

      // Hardware-target profiles can never settle on software-rendered (non-target)
      // evidence — blocked, never passed — while structural budgets remain valid
      // everywhere (REQ-PERF-003).
      if (nonTargetOnly) {
        const reason =
          `verification blocked — non-target renderer evidence (${perfEvidence?.renderer_class ?? "unknown"}) ` +
          `cannot satisfy hardware-target profile '${input.performance.profile.id}' ` +
          `(environment binding '${input.performance.profile.environment_binding}'); ` +
          "structural budgets remain enforceable and all declared structural checks passed; " +
          "a software-rendered run must not masquerade as target-hardware evidence";
        return {
          decision: "blocked",
          blockage_class: "hardware_target_unavailable",
          reason,
          contradictions,
          channel_verdicts: verdicts,
          record: buildRecord(expectation, run, manifestIds, {
            decision: "blocked",
            blockage_class: "hardware_target_unavailable",
            reason,
            now,
          }),
        };
      }

      // A violated declared budget is budget_error -> FAILED settlement (REQ-PERF-004),
      // never a warning, and visual/semantic success cannot mask it.
      const failing = failed
        .flatMap((v) => v.checks.filter((c) => !c.pass).map((c) => `${v.channel}/${c.code}: ${c.detail}`))
        .join("; ");
      const budgetCitation = evaluation.violations
        .map((v) => `${v.budget} limit ${v.limit}, measured ${v.measured}`)
        .join("; ");
      const reason =
        `verification failed — ${failing}` +
        (budgetCitation
          ? ` [budget_error: quality profile '${input.performance.profile.id}' violated: ${budgetCitation}]`
          : "") +
        (contradictions.length > 0 ? ` [contradiction: ${contradictions.join(" | ")}]` : "") +
        ` (classified: runtime_consequence_deficit); failed evidence is preserved append-only`;
      return {
        decision: "failed",
        blockage_class: "runtime_consequence_deficit",
        reason,
        contradictions,
        channel_verdicts: verdicts,
        ...(evaluation.budget_error
          ? {
              budget_error: {
                code: evaluation.budget_error.code,
                quality_profile: evaluation.budget_error.details.quality_profile,
                violations: evaluation.budget_error.details.violations,
                recoverability: evaluation.budget_error.details.recoverability,
              },
            }
          : {}),
        record: buildRecord(expectation, run, manifestIds, {
          decision: "failed",
          blockage_class: "runtime_consequence_deficit",
          reason,
          now,
        }),
      };
    }

    let blockage: BlockageClass = "represented_but_deficient";
    const stateV = verdicts.find((v) => v.channel === "state");
    if (stateV && !stateV.pass && stateV.evaluated) blockage = classifySemanticFailure(stateV);
    else if (verdicts.some((v) => v.channel === "pixels" && !v.pass)) blockage = "visual_consequence_deficit";
    else if (verdicts.some((v) => v.channel === "telemetry" && !v.pass)) blockage = "runtime_consequence_deficit";
    else if (verdicts.some((v) => v.channel === "network" && !v.pass)) blockage = "network_consequence_deficit";
    else if (verdicts.some((v) => v.channel === "performance" && !v.pass)) blockage = "runtime_consequence_deficit";

    const failing = failed
      .flatMap((v) => v.checks.filter((c) => !c.pass).map((c) => `${v.channel}/${c.code}: ${c.detail}`))
      .join("; ");
    const reason =
      `verification failed — ${failing}` +
      (contradictions.length > 0 ? ` [contradiction: ${contradictions.join(" | ")}]` : "") +
      ` (classified: ${blockage}); failed evidence is preserved append-only`;

    return {
      decision: "failed",
      blockage_class: blockage,
      reason,
      contradictions,
      channel_verdicts: verdicts,
      record: buildRecord(expectation, run, manifestIds, {
        decision: "failed",
        blockage_class: blockage,
        reason,
        now,
      }),
    };
  }

  // 6. Confirmation gate: a missing required confirmation MUST prevent settled.
  if (expectation.requires_confirmation && !input.confirmation) {
    return {
      decision: "incomplete",
      blockage_class: "confirmation_required",
      reason:
        "all claimed channels pass on fresh correlated evidence, but the expectation requires an " +
        "independent confirmation that has not been recorded; settlement is prevented",
      contradictions,
      channel_verdicts: verdicts,
      record: buildRecord(expectation, run, manifestIds, {
        decision: "incomplete",
        blockage_class: "confirmation_required",
        reason: "required confirmation not yet recorded; settlement prevented",
        now,
      }),
    };
  }

  // 7. Settled: fresh, correlated, channel-appropriate evidence, all checks pass.
  const summary = verdicts
    .map((v) => `${v.channel}: ${v.checks.filter((c) => c.pass).length}/${v.checks.length} checks pass`)
    .join(", ");
  const reason =
    `settled on fresh correlated evidence for revision ${run.project_revision} ` +
    `(run ${run.id}; ${summary})` +
    (input.confirmation ? `; confirmation ${input.confirmation.mode} recorded` : "");
  return {
    decision: "settled",
    reason,
    contradictions: [],
    channel_verdicts: verdicts,
    record: buildRecord(expectation, run, manifestIds, {
      decision: "settled",
      reason,
      now,
      confirmation_ref: input.confirmation
        ? `${input.confirmation.mode}:${input.confirmation.ref}`
        : undefined,
    }),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface RecordSpec {
  decision: SettlementDecision;
  blockage_class?: BlockageClass;
  reason: string;
  now: string;
  confirmation_ref?: string;
}

function buildRecord(
  expectation: FrozenExpectation,
  run: ObservationRun,
  manifestIds: string[],
  spec: RecordSpec
): SettlementRecord {
  const record: SettlementRecord = {
    id: `settlement-${expectation.id}-${run.id}`,
    requirement_ids: [...expectation.requirement_ids],
    decision: spec.decision,
    evidence_manifest_ids: manifestIds,
    reason: spec.reason,
    settled_at: spec.now,
  };
  if (spec.blockage_class) record.blockage_class = spec.blockage_class;
  if (spec.confirmation_ref) record.confirmation_ref = spec.confirmation_ref;
  const affordance = nextAffordanceFor(spec.decision, spec.blockage_class);
  if (affordance) record.next_affordance = affordance;
  SettlementRecordSchema.parse(record);
  return record;
}

function staleOutcome(
  base: SettlementInput,
  why: string
): SettlementOutcome {
  const { expectation, run, manifests } = base;
  const manifestIds = manifests.map((m) => m.id);
  const now = base.now ?? new Date().toISOString();
  const record = buildRecord(expectation, run as ObservationRun, manifestIds, {
    decision: "incomplete",
    blockage_class: "evidence_stale",
    reason: `stale evidence rejected: ${why}`,
    now,
  });
  return {
    decision: "incomplete",
    blockage_class: "evidence_stale",
    reason: `stale evidence rejected: ${why}; freshness comes from run/revision identity, not filenames`,
    contradictions: [],
    channel_verdicts: [],
    record,
  };
}
