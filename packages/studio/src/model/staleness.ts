/**
 * Model-derived staleness engine (REQ-STALE-002..004, spec v0.5.0).
 *
 * Pure, deterministic functions. A derivative is stale exactly when a decision
 * recorded at a model version newer than the derivative's `built_from` touches
 * a field or resource the derivative reads. No manual invalidation lists; no
 * global staling: a decision that does not overlap a derivative's reads leaves
 * that derivative current.
 */

import type { GameModelDecision, DerivativeStamp } from "@gauntlet/contracts";

/**
 * Whether a decision's `touched` list overlaps a derivative's `reads` list.
 * Matching rules:
 *  - "all" touches everything;
 *  - an exact key match touches ("camera" ↔ "camera");
 *  - a hierarchical prefix touches ("camera" touches "camera.mode";
 *    "languages" touches "languages.material").
 */
export function touches(touched: readonly string[], reads: readonly string[]): boolean {
  for (const t of touched) {
    if (t === "all") return true;
    for (const r of reads) {
      // Symmetric hierarchy: a decision touching a parent field stales a
      // child-field reader, and a decision touching a child field stales a
      // reader of the whole parent section — over-staling is conservative,
      // under-staling would be a silent staleness lie.
      if (r === t || r.startsWith(`${t}.`) || t.startsWith(`${r}.`)) return true;
    }
  }
  return false;
}

/**
 * Ordinals of decisions newer than the stamp that touch the stamp's reads.
 * Pure function of the stamp and the decision ledger.
 */
export function staleReasons(
  stamp: Pick<DerivativeStamp, "built_from" | "reads">,
  decisions: readonly GameModelDecision[],
): number[] {
  return decisions
    .filter((d) => d.version > stamp.built_from && touches(d.touched, stamp.reads))
    .map((d) => d.n);
}

export type ModelStalenessErrorCode =
  | "MODEL_STALE_DERIVATIVE"
  | "MODEL_DERIVATIVE_UNSTAMPED";

export class ModelStalenessError extends Error {
  constructor(
    readonly code: ModelStalenessErrorCode,
    readonly subject: string,
    readonly detail: string,
  ) {
    super(`${code} (${subject}): ${detail}`);
    this.name = "ModelStalenessError";
  }
}

/**
 * Typed gate for settlement paths: evidence that was derived from an older
 * model version, and whose reads are touched by newer decisions, MUST NOT
 * settle new claims until re-derived (REQ-STALE-004). Unstamped model-derived
 * evidence is rejected as unstamped rather than silently accepted.
 */
export function assertEvidenceFreshAgainstModel(
  subject: string,
  stamp: DerivativeStamp | null,
  decisions: readonly GameModelDecision[],
  currentModelVersion: number,
): void {
  if (stamp === null) {
    throw new ModelStalenessError(
      "MODEL_DERIVATIVE_UNSTAMPED",
      subject,
      `evidence derived from the Game Model must record built_from/reads before it can settle (current model version ${currentModelVersion})`,
    );
  }
  const reasons = staleReasons(stamp, decisions);
  if (reasons.length > 0) {
    throw new ModelStalenessError(
      "MODEL_STALE_DERIVATIVE",
      subject,
      `built from model@${stamp.built_from} but decisions ${reasons.join(", ")} touched its reads; re-derive against model@${currentModelVersion}`,
    );
  }
}

/**
 * Reads that name no declared model section, extension, or resource scope.
 * Returned so callers can surface them as unavailable rather than silently
 * dropping them (REQ-GM-006): a read pointing nowhere is a fog signal, not a
 * match and not a mismatch.
 */
export function absentReads(
  reads: readonly string[],
  declared: { knownKeys: readonly string[]; extensionKeys: readonly string[] },
): string[] {
  const resourcePrefixes = ["asset:", "entity:", "recipe:", "evidence:", "resource:"];
  const knownRoots = new Set([...declared.knownKeys, ...declared.extensionKeys]);
  return reads.filter((r) => {
    if (resourcePrefixes.some((p) => r.startsWith(p))) return false;
    const root = r.split(".")[0];
    return !knownRoots.has(root);
  });
}
