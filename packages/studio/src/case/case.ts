/**
 * The Game Case (REQ-CASE-001..003, spec v0.5.0).
 *
 * A derived, read-only view of the project around one present purpose:
 * answering where the game stands against its declared release bar and what
 * the single most leverage-rich reachable move is. It is stored nowhere and it
 * acts not at all — a pure function of canonical state. The primary move is
 * guidance, never authority; release is never silently decided here.
 *
 * Move selection optimizes release-relevant leverage in a fixed preference
 * order (REQ-CASE-002): release blockers > contradictions > multi-affordance
 * enablement > resource leverage > cheap uncertainty elimination > visibly
 * broken player experience > largest quality gap > platform-specific
 * blockers. It never optimizes for task counts, content volume, or activity.
 */

import type { GameModel } from "../model/model";
import type { StalenessReportRow } from "../model/model";
import type { QualityBarEvaluation, ReleaseMatrix } from "../quality/bar";

export type DeviationKind =
  | "contradiction"
  | "blocker"
  | "stale-derivative"
  | "quality-gap"
  | "unknown"
  | "resource-gap";

export type DeviationSeverity = "interrupt" | "salient" | "quiet";

export interface Deviation {
  key: string;
  kind: DeviationKind;
  severity: DeviationSeverity;
  text: string;
  ref?: string;
}

export type MoveLane = "next-move" | "choose" | "alternatives" | "blocked";

export interface CaseMove {
  id: string;
  label: string;
  lane: MoveLane;
  /** Preference rank per REQ-CASE-002 (1 = highest leverage). */
  leverage: number;
  why: string;
  cost_estimate: string;
  authority: "agent" | "owner" | "owner-review-required";
  recovery: string;
  expected_evidence: string[];
  opens: string[];
  requires: { what: string; met: boolean }[];
  blocked_by?: string[];
}

export interface GameCase {
  ok: true;
  authoritative: false;
  derived_from: string[];
  destination: { text: string; release_bar: string; declared_by: string };
  current: string;
  deviations: Deviation[];
  material: Deviation | null;
  primary_move: CaseMove | null;
  alternatives: CaseMove[];
  blocked: CaseMove[];
  settlement: { reachable: boolean; note: string };
  counts: { deviations: number; available: number; blocked: number };
}

export interface GameCaseInput {
  model: GameModel;
  staleness: StalenessReportRow[];
  quality: QualityBarEvaluation;
  release: ReleaseMatrix;
  /** Blocked resource resolution records (request id, status code). */
  resourceGaps?: { requested_id: string; status_code: string; route?: string }[];
  openUnknowns?: { id: string; question: string }[];
  workInFlight?: number;
}

const SEVERITY_ORDER: Record<DeviationSeverity, number> = { interrupt: 0, salient: 1, quiet: 2 };

function move(input: Omit<CaseMove, "opens" | "requires"> & Partial<Pick<CaseMove, "opens" | "requires">>): CaseMove {
  return {
    opens: [],
    requires: [],
    ...input,
  };
}

/**
 * Derive the Game Case. Pure with respect to its inputs; no canonical file is
 * read or written here.
 */
export function deriveGameCase(input: GameCaseInput): GameCase {
  const { model, staleness, quality, release } = input;
  const identity = model.known.identity!;
  const deviations: Deviation[] = [];

  // Contradictions outrank optimistic progress: interrupt severity.
  for (const c of model.known.contradictions ?? []) {
    deviations.push({ key: `contradiction:${c.id}`, kind: "contradiction", severity: "interrupt", text: c.text, ref: c.id });
  }
  for (const row of quality.rows.filter((r) => r.state === "fail")) {
    deviations.push({
      key: `quality-fail:${row.criterion_id}`,
      kind: "quality-gap",
      severity: "interrupt",
      text: `quality criterion '${row.criterion_id}' fails: ${row.requirement}`,
      ref: `criterion:${row.criterion_id}`,
    });
  }

  // Release blockers.
  const unsettledTargets = release.targets.filter((t) => t.settlement !== "settled");
  for (const t of unsettledTargets) {
    const failing = t.dimensions.filter((d) => d.state === "fail");
    const blockedDims = t.dimensions.filter((d) => d.state === "blocked");
    if (failing.length > 0 || blockedDims.length > 0) {
      deviations.push({
        key: `release-blocker:${t.target}`,
        kind: "blocker",
        severity: "interrupt",
        text: `release target '${t.target}' has ${failing.length} failing and ${blockedDims.length} evidence-blocked dimensions`,
        ref: `target:${t.target}`,
      });
    } else if (t.settlement === "unsettled") {
      deviations.push({
        key: `release-unsettled:${t.target}`,
        kind: "blocker",
        severity: "quiet",
        text: `release target '${t.target}' still has unknown dimensions (evidence required)`,
        ref: `target:${t.target}`,
      });
    }
  }

  // Stale derivatives: targeted, visible, never smoothed.
  const stale = staleness.filter((s) => s.stale);
  if (stale.length > 0) {
    deviations.push({
      key: "stale-derivatives",
      kind: "stale-derivative",
      severity: "salient",
      text: `${stale.length} derivative(s) stale against the current model (e.g. ${stale.slice(0, 3).map((s) => s.id).join(", ")})`,
    });
  }
  const unstamped = staleness.filter((s) => !s.stamped);
  if (unstamped.length > 0) {
    deviations.push({
      key: "unstamped-derivatives",
      kind: "stale-derivative",
      severity: "quiet",
      text: `${unstamped.length} derivative(s) carry no built_from/reads stamp (REQ-STALE-001 pressure)`,
    });
  }

  // Quality gaps below fail.
  for (const row of quality.rows.filter((r) => r.state === "attention")) {
    deviations.push({
      key: `quality-attention:${row.criterion_id}`,
      kind: "quality-gap",
      severity: "salient",
      text: `quality criterion '${row.criterion_id}' needs attention: ${row.reason ?? row.requirement}`,
      ref: `criterion:${row.criterion_id}`,
    });
  }
  const unknownCriteria = quality.rows.filter((r) => r.state === "unknown");
  if (unknownCriteria.length > 0) {
    deviations.push({
      key: "quality-unknowns",
      kind: "unknown",
      severity: "quiet",
      text: `${unknownCriteria.length} quality criterion(s) unknown (no linked evidence)`,
    });
  }

  // Resource gaps.
  for (const gap of input.resourceGaps ?? []) {
    deviations.push({
      key: `resource-gap:${gap.requested_id}`,
      kind: "resource-gap",
      severity: "salient",
      text: `resource '${gap.requested_id}' unresolved (${gap.status_code}) — cheaper routes exhausted or exception required`,
      ref: `resource:${gap.requested_id}`,
    });
  }

  // Open unknowns from the model.
  for (const u of input.openUnknowns ?? (model.known.unknowns ?? []).filter((x) => x.status === "open")) {
    deviations.push({ key: `unknown:${u.id}`, kind: "unknown", severity: "quiet", text: u.question, ref: u.id });
  }

  deviations.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const material = deviations.find((d) => d.severity === "interrupt") ?? deviations[0] ?? null;

  // ── Moves ────────────────────────────────────────────────────────────────
  const available: CaseMove[] = [];
  const blocked: CaseMove[] = [];

  // 1. Clearing release blockers (leverage 1).
  for (const t of unsettledTargets) {
    const failing = t.dimensions.filter((d) => d.state === "fail");
    if (failing.length > 0) {
      available.push(
        move({
          id: `fix-release:${t.target}`,
          label: `Repair failing release dimensions on '${t.target}'`,
          lane: "next-move",
          leverage: 1,
          why: `release target '${t.target}' fails ${failing.map((d) => d.dimension).join(", ")} — no release settlement while these fail`,
          cost_estimate: "unknown without per-dimension evidence; do not fabricate precision",
          authority: "agent",
          recovery: "reversible — fixes are evidence-gated and re-derivable",
          expected_evidence: [`${t.target} dimension evidence flipping fail → pass`, `release matrix row '${t.target}' settling`],
          requires: [{ what: "scenario evidence for failing dimensions", met: false }],
        }),
      );
    }
    const unknownDims = t.dimensions.filter((d) => d.state === "unknown");
    if (failing.length === 0 && unknownDims.length > 0) {
      available.push(
        move({
          id: `evidence-release:${t.target}`,
          label: `Gather missing evidence for '${t.target}' (${unknownDims.length} unknown dimensions)`,
          lane: "next-move",
          leverage: 2,
          why: "unknown dimensions block settlement; producing the declared evidence eliminates release uncertainty",
          cost_estimate: "one scenario/observation run per dimension; bounded",
          authority: "agent",
          recovery: "reversible — observations are append-only",
          expected_evidence: [`${t.target} dimension states unknown → pass/fail with linked runs`],
          requires: [{ what: "declared scenarios covering the dimensions", met: true }],
        }),
      );
    }
  }

  // 2. Resolving contradictions (leverage 1).
  for (const c of model.known.contradictions ?? []) {
    available.push(
      move({
        id: `resolve-contradiction:${c.id}`,
        label: `Resolve contradiction '${c.id}'`,
        lane: "next-move",
        leverage: 1,
        why: "contradictions outrank optimistic progress; every downstream claim built on them is unsound until resolved",
        cost_estimate: "one investigation pass; typically small",
        authority: "owner-review-required",
        recovery: "reversible — resolution is a recorded model decision",
        expected_evidence: ["contradiction removed via a recorded decision", "affected derivatives re-staled and re-derived"],
        requires: [{ what: "owner ruling or decisive evidence", met: false }],
      }),
    );
  }

  // 3. Re-deriving stale derivatives (leverage 3).
  if (stale.length > 0) {
    available.push(
      move({
        id: "re-derive-stale",
        label: `Re-derive ${stale.length} stale derivative(s) against the current model`,
        lane: "next-move",
        leverage: 3,
        why: "stale evidence cannot settle; re-derivation unblocks every downstream claim",
        cost_estimate: "proportional to stale count; targeted by staleness report",
        authority: "agent",
        recovery: "reversible — old evidence preserved (append-only)",
        expected_evidence: ["stale rows in the staleness report → current", "settlement gate passes"],
        requires: [{ what: "staleness report", met: true }],
      }),
    );
  }

  // 4. Resource leverage (leverage 4): resolve blocked resources through the
  // minimum-novelty cascade instead of bespoke creation.
  for (const gap of input.resourceGaps ?? []) {
    available.push(
      move({
        id: `resolve-resource:${gap.requested_id}`,
        label: `Resolve resource gap '${gap.requested_id}' through the reuse-first cascade`,
        lane: "alternatives",
        leverage: 4,
        why: `blocked at ${gap.status_code}; resolving with a reservoir/permissive resource replaces bespoke work`,
        cost_estimate: "one resolution pass; cheaper than scratch creation by policy",
        authority: "agent",
        recovery: "reversible — resolution records are append-only",
        expected_evidence: ["resolution record with resolved route", "asset/resource intake accepted"],
        requires: [{ what: "provider or reservoir availability", met: false }],
      }),
    );
  }

  // 5. Eliminating uncertainty cheaply (leverage 5).
  const openUnknowns = input.openUnknowns ?? (model.known.unknowns ?? []).filter((x) => x.status === "open");
  for (const u of openUnknowns.slice(0, 4)) {
    available.push(
      move({
        id: `resolve-unknown:${u.id}`,
        label: `Resolve unknown '${u.id}'`,
        lane: "choose",
        leverage: 5,
        why: "cheap uncertainty elimination — the answer changes downstream design or evidence",
        cost_estimate: "small: one decision or one probe",
        authority: "owner-review-required",
        recovery: "reversible — unknowns close via recorded decisions",
        expected_evidence: [`unknown '${u.id}' closed with resolution`],
        requires: [{ what: "owner input or a cheap probe", met: false }],
      }),
    );
  }

  // 6. Largest evidence-backed quality gap (leverage 7).
  const attention = quality.rows.filter((r) => r.state === "attention");
  if (attention.length > 0) {
    available.push(
      move({
        id: "improve-quality-attention",
        label: `Address ${attention.length} attention-state quality criterion/criteria`,
        lane: "alternatives",
        leverage: 7,
        why: "evidence shows the largest meaningful quality gaps here",
        cost_estimate: "per-criterion; bounded by the criterion text",
        authority: "agent",
        recovery: "reversible",
        expected_evidence: ["criterion states attention → pass with fresh evidence"],
        requires: [{ what: "review of the failing evidence", met: true }],
      }),
    );
  }

  // Blocked moves: things that look attractive but are not reachable.
  if (unstamped.length > 0) {
    blocked.push(
      move({
        id: "settle-all",
        label: "Settle the whole release",
        lane: "blocked",
        leverage: 99,
        why: "settlement requires per-target evidence; shortcutting it would forge readiness",
        cost_estimate: "not applicable",
        authority: "owner",
        recovery: "not reversible as a shortcut; settle per target instead",
        expected_evidence: [],
        requires: [{ what: "every dimension settled per target", met: false }],
        blocked_by: [
          ...(unstamped.length > 0 ? [`${unstamped.length} unstamped derivatives must record built_from/reads first`] : []),
          "release matrix targets with unknown dimensions",
        ],
      }),
    );
  }
  for (const t of release.targets) {
    const blockedDims = t.dimensions.filter((d) => d.state === "blocked");
    if (blockedDims.length > 0) {
      blocked.push(
        move({
          id: `settle-target:${t.target}`,
          label: `Settle release target '${t.target}' now`,
          lane: "blocked",
          leverage: 99,
          why: "evidence for this target is blocked (e.g. only non-target software-rendered evidence exists)",
          cost_estimate: "not applicable until target toolchain/evidence exists",
          authority: "owner",
          recovery: "revisit when target evidence becomes available",
          expected_evidence: [],
          requires: [{ what: "target-appropriate evidence", met: false }],
          blocked_by: blockedDims.map((d) => `${d.dimension}: ${d.reason ?? "blocked"}`),
        }),
      );
    }
  }

  // Primary move: the first available move that resolves the material
  // deviation, else the highest-leverage available move. Guidance only.
  const resolving = material
    ? available.filter((m) => {
        if (material.kind === "contradiction") return m.id.startsWith("resolve-contradiction:");
        if (material.kind === "blocker") return m.id.startsWith("fix-release:") || m.id.startsWith("evidence-release:");
        if (material.kind === "stale-derivative") return m.id === "re-derive-stale";
        if (material.kind === "resource-gap") return m.id.startsWith("resolve-resource:");
        if (material.kind === "quality-gap") return m.id.startsWith("fix-release:") || m.id === "improve-quality-attention";
        return false;
      })
    : [];
  const primary = resolving[0] ?? available.slice().sort((a, b) => a.leverage - b.leverage)[0] ?? null;

  const destinationText =
    model.known.core_loop?.summary ??
    model.known.fantasy ??
    identity.title;
  const releaseBarText = model.known.quality_bar
    ? `${model.known.quality_bar.criteria.length} declared quality criteria`
    : "no quality bar declared — release bar undefined";

  const settledTargets = release.targets.filter((t) => t.settlement === "settled").length;
  const currentText = [
    `model@${model.modelVersion}`,
    `${quality.counts.pass} pass / ${quality.counts.attention} attention / ${quality.counts.fail} fail / ${quality.counts.unknown} unknown quality criteria`,
    `${settledTargets}/${release.targets.length} release targets settled`,
    stale.length > 0 ? `${stale.length} stale derivatives` : "no stale derivatives",
    input.workInFlight ? `${input.workInFlight} work request(s) in flight` : "no work in flight",
  ].join("; ");

  return {
    ok: true,
    authoritative: false,
    derived_from: [model.path, "staleness report", "quality bar evaluation", "release matrix", "resource resolution records"],
    destination: { text: destinationText, release_bar: releaseBarText, declared_by: "Game Model" },
    current: currentText,
    deviations,
    material,
    primary_move: primary,
    alternatives: available.filter((m) => m !== primary).slice(0, 4),
    blocked,
    settlement: {
      reachable: unsettledTargets.length === 0 && deviations.every((d) => d.kind !== "contradiction"),
      note: "settlement reachability is a derived representation; the release verdict is the owner's, settled only through Gauntlet settlement channels",
    },
    counts: {
      deviations: deviations.length,
      available: available.length,
      blocked: blocked.length,
    },
  };
}
