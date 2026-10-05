/**
 * Coherence normalization (REQ-NORM-001..002, spec v0.5.0).
 *
 * A NormalizationPlan records the systematic transformations an acquired
 * resource needs toward the art, material, lighting, and animation language
 * the Game Model declares. The plan is bound to the model language sections it
 * conforms to (`model_reads` must name declared sections — a plan pointing at
 * fog is rejected, REQ-GM-006); provenance of the source is carried verbatim
 * (REQ-NORM-002).
 */

import { NormalizationPlanSchema, type NormalizationPlan, type ResourceKind } from "@gauntlet/contracts";
import type { GameModel } from "../model/model";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type NormalizationErrorCode =
  | "NORMALIZATION_PLAN_INVALID"
  | "MODEL_LANGUAGE_UNDECLARED"
  | "NORMALIZATION_NOT_FOUND";

export class NormalizationError extends Error {
  constructor(
    readonly code: NormalizationErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "NormalizationError";
  }
}

export interface BuildNormalizationPlanInput {
  id: string;
  target: string;
  kind: ResourceKind;
  model: GameModel;
  transforms: NormalizationPlan["transforms"];
  source_provenance: NormalizationPlan["source_provenance"];
  built_from?: number;
  recorded_at?: string;
}

const LANGUAGE_ROOT = "languages";

/**
 * Build (and validate) a normalization plan. Every transform is bound to a
 * declared model language section: a transform whose `params.model_language`
 * names a section uses that binding; otherwise the op class picks the natural
 * language (material ops → languages.material, animation ops →
 * languages.animation, else languages.visual), and a language the model does
 * not declare is reported as undeclared rather than silently defaulted
 * (REQ-GM-006: absent facts are not defaults).
 */
export function buildNormalizationPlan(input: BuildNormalizationPlanInput): NormalizationPlan {
  const declaredRoots = new Set([...Object.keys(input.model.known), ...Object.keys(input.model.extensions)]);
  const languageKeys = Object.keys(input.model.known.languages ?? {});

  const reads = new Set<string>();
  for (const transform of input.transforms) {
    const params = transform.params as Record<string, string | number | boolean>;
    const declared = params.model_language;
    let read: string;
    if (typeof declared === "string" && declared.length > 0) {
      read = declared;
    } else if (transform.op === "skeleton-convention" || transform.op === "animation-naming") {
      read = languageKeys.includes("animation") ? `${LANGUAGE_ROOT}.animation` : LANGUAGE_ROOT;
    } else if (
      transform.op === "palette" ||
      transform.op === "roughness-range" ||
      transform.op === "metalness-range" ||
      transform.op === "normal-intensity" ||
      transform.op === "material-model"
    ) {
      read = languageKeys.includes("material") ? `${LANGUAGE_ROOT}.material` : LANGUAGE_ROOT;
    } else {
      read = languageKeys.includes("visual") ? `${LANGUAGE_ROOT}.visual` : LANGUAGE_ROOT;
    }

    const root = read.split(".")[0];
    if (!declaredRoots.has(root)) {
      throw new NormalizationError(
        "MODEL_LANGUAGE_UNDECLARED",
        `plan '${input.id}' reads '${read}' but the model declares no '${root}' section — absent facts are not defaults`,
      );
    }
    if (root === LANGUAGE_ROOT && read !== LANGUAGE_ROOT) {
      const sub = read.split(".")[1];
      if (!sub || !languageKeys.includes(sub)) {
        throw new NormalizationError(
          "MODEL_LANGUAGE_UNDECLARED",
          `plan '${input.id}' reads '${read}' but the model declares only [${languageKeys.join(", ") || "no languages"}]`,
        );
      }
    }
    reads.add(read);
  }

  const plan = NormalizationPlanSchema.parse({
    schema: "gauntlet.resource.normalization",
    schema_version: "1.0",
    id: input.id,
    target: input.target,
    kind: input.kind,
    model_reads: [...reads],
    transforms: input.transforms,
    source_provenance: input.source_provenance,
    built_from: input.built_from ?? input.model.modelVersion,
    executed: false,
    execution_refs: [],
    recorded_at: input.recorded_at ?? new Date().toISOString(),
  });
  return plan;
}

/**
 * Persist a plan under `.studio/normalizations/<id>.json`.
 */
export function persistNormalizationPlan(projectRoot: string, plan: NormalizationPlan): string {
  const dir = join(projectRoot.replace(/\/$/, ""), ".studio", "normalizations");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${plan.id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  Bun.write(path, JSON.stringify(plan, null, 2));
  return path;
}

export function loadNormalizationPlan(projectRoot: string, id: string): NormalizationPlan {
  const path = join(projectRoot.replace(/\/$/, ""), ".studio", "normalizations", `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  if (!existsSync(path)) {
    throw new NormalizationError("NORMALIZATION_NOT_FOUND", `no normalization plan '${id}'`);
  }
  return NormalizationPlanSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Record execution: flips `executed` and appends verification refs
 * (deterministic transform logs, glTF-Transform reports, DCC job evidence).
 * The plan is never silently rewritten beyond execution recording.
 */
export function recordNormalizationExecution(
  projectRoot: string,
  id: string,
  executionRefs: string[],
): NormalizationPlan {
  const plan = loadNormalizationPlan(projectRoot, id);
  const executed = NormalizationPlanSchema.parse({
    ...plan,
    executed: true,
    execution_refs: [...new Set([...plan.execution_refs, ...executionRefs])],
  });
  persistNormalizationPlan(projectRoot, executed);
  return executed;
}
