/**
 * Canonical Game Model (REQ-GM-001..006, spec v0.5.0).
 *
 * Each game project's `.agents/specs/game.spec.yaml` is the single declared-truth
 * authority. The loader validates the typed core strictly, preserves per-game
 * extension sections without inventing semantics for them, and reads existing
 * `gauntlet.game.spec` v1 files without rewriting them. The only mutation path
 * is `applyDecision`, which appends a decision-ledger record and bumps
 * `model_version`; there is no API that edits the model silently (REQ-GM-004).
 */

import {
  DerivativeStampSchema,
  GameModelKnownSchema,
  type GameModelDecision,
  type GameModelKnown,
} from "@gauntlet/contracts";
import type { DerivativeStamp } from "@gauntlet/contracts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { QualityProfileSchema } from "../quality/profiles";
import { touches, staleReasons, absentReads } from "./staleness";

export interface GameModel {
  path: string;
  schema: string;
  schemaVersion: string;
  modelVersion: number;
  known: Partial<GameModelKnown>;
  qualityProfiles: Record<string, unknown>;
  extensions: Record<string, unknown>;
  decisions: GameModelDecision[];
  /** v1 sections preserved as extensions because their payload predates the v0.5.0 typed core. */
  legacySections: string[];
}

export type GameModelLoadErrorCode =
  | "GAME_SPEC_UNREADABLE"
  | "GAME_MODEL_SCHEMA_INVALID"
  | "GAME_IDENTITY_MISSING"
  | "GAME_MODEL_LEDGER_INCONSISTENT";

export class GameModelLoadError extends Error {
  constructor(
    readonly code: GameModelLoadErrorCode,
    readonly path: string,
    readonly detail: string,
  ) {
    super(`${code} (${path}): ${detail}`);
    this.name = "GameModelLoadError";
  }
}

const KNOWN_SECTION_KEYS = new Set(Object.keys(GameModelKnownSchema.shape));

export function gameSpecPathFor(projectRoot: string): string {
  return `${projectRoot.replace(/\/$/, "")}/.agents/specs/game.spec.yaml`;
}

/**
 * Load and validate the canonical Game Model. Existing `gauntlet.game.spec` v1
 * projects load unchanged: unknown free-form sections are preserved verbatim
 * under `extensions` and quality profiles are validated against the game-owned
 * profile schema.
 */
export function loadGameModel(path: string): GameModel {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new GameModelLoadError("GAME_SPEC_UNREADABLE", path, String(error));
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (error) {
    throw new GameModelLoadError("GAME_MODEL_SCHEMA_INVALID", path, `YAML parse failed: ${String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GameModelLoadError("GAME_MODEL_SCHEMA_INVALID", path, "top-level document must be a mapping");
  }

  const doc = parsed as Record<string, unknown>;
  const schemaName = typeof doc.schema === "string" ? doc.schema : undefined;
  if (schemaName !== undefined && schemaName !== "gauntlet.game.model" && schemaName !== "gauntlet.game.spec") {
    throw new GameModelLoadError("GAME_MODEL_SCHEMA_INVALID", path, `unknown schema '${schemaName}'`);
  }
  const schemaVersion = typeof doc.schema_version === "string" ? doc.schema_version : "1.0";
  const isCanonical = schemaName === "gauntlet.game.model";

  const knownInput: Record<string, unknown> = {};
  const extensions: Record<string, unknown> = {};
  const legacySections: string[] = [];
  for (const [key, value] of Object.entries(doc)) {
    if (key === "quality_profiles") continue;
    if (!KNOWN_SECTION_KEYS.has(key)) {
      extensions[key] = value;
      continue;
    }
    const sectionSchema = (GameModelKnownSchema.shape as Record<string, { parse: (v: unknown) => unknown }>)[key];
    try {
      sectionSchema.parse(value);
      knownInput[key] = value;
    } catch (error) {
      if (isCanonical) {
        throw new GameModelLoadError(
          "GAME_MODEL_SCHEMA_INVALID",
          path,
          `typed section '${key}' rejected: ${String(error)}`,
        );
      }
      // v1 legacy tolerance (REQ-GM-005): preserve the section verbatim as an
      // extension rather than inventing semantics for a pre-v0.5.0 payload.
      extensions[key] = value;
      legacySections.push(key);
    }
  }

  // v1 identity fallback: pre-v0.5.0 specs carry top-level game_id/title.
  if (knownInput.identity === undefined) {
    const gameId = doc.game_id;
    const title = doc.title;
    if (typeof gameId === "string" && typeof title === "string") {
      knownInput.identity = { game_id: gameId, title };
    }
  }

  let known: Partial<GameModelKnown>;
  try {
    known = GameModelKnownSchema.parse(knownInput) as Partial<GameModelKnown>;
  } catch (error) {
    throw new GameModelLoadError("GAME_MODEL_SCHEMA_INVALID", path, `typed core rejected: ${String(error)}`);
  }

  const qualityProfiles: Record<string, unknown> = {};
  if (doc.quality_profiles !== undefined) {
    if (doc.quality_profiles === null || typeof doc.quality_profiles !== "object" || Array.isArray(doc.quality_profiles)) {
      throw new GameModelLoadError("GAME_MODEL_SCHEMA_INVALID", path, "quality_profiles must be a mapping");
    }
    for (const [id, profile] of Object.entries(doc.quality_profiles as Record<string, unknown>)) {
      try {
        QualityProfileSchema.parse(profile);
      } catch (error) {
        throw new GameModelLoadError("GAME_MODEL_SCHEMA_INVALID", path, `quality profile '${id}' rejected: ${String(error)}`);
      }
      qualityProfiles[id] = profile;
    }
  }

  const modelVersion = known.model_version ?? 0;
  const decisions = known.decisions ?? [];

  // Ledger consistency (REQ-GM-003): a nonzero model version implies at least
  // one decision, no decision may claim a version newer than the file, and the
  // current version must have been produced by a recorded decision — a bare
  // version bump without a ledger record is a silent mutation.
  if (modelVersion > 0 && decisions.length === 0) {
    throw new GameModelLoadError(
      "GAME_MODEL_LEDGER_INCONSISTENT",
      path,
      `model_version ${modelVersion} but the decision ledger is empty — a model change was written without a decision record`,
    );
  }
  if (modelVersion > 0 && !decisions.some((d) => d.version === modelVersion)) {
    throw new GameModelLoadError(
      "GAME_MODEL_LEDGER_INCONSISTENT",
      path,
      `model_version ${modelVersion} but no decision records that version — a model change was written without a decision record`,
    );
  }
  for (const decision of decisions) {
    if (decision.version > modelVersion) {
      throw new GameModelLoadError(
        "GAME_MODEL_LEDGER_INCONSISTENT",
        path,
        `decision ${decision.n} claims version ${decision.version} newer than model_version ${modelVersion}`,
      );
    }
  }

  if (!known.identity || !known.identity.game_id || !known.identity.title) {
    throw new GameModelLoadError("GAME_IDENTITY_MISSING", path, "identity.game_id and identity.title are required");
  }

  return {
    path,
    schema: schemaName ?? "gauntlet.game.spec",
    schemaVersion,
    modelVersion,
    known,
    qualityProfiles,
    extensions,
    decisions,
    legacySections,
  };
}

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function yamlListValue(values: string[]): string {
  if (values.length === 0) return "[]";
  return `[${values.map((v) => (/^[\w.:/-]+$/.test(v) ? v : JSON.stringify(v))).join(", ")}]`;
}

function decisionEntryLines(decision: GameModelDecision, indent: string): string[] {
  const lines = [
    `${indent}- n: ${decision.n}`,
    `${indent}  version: ${decision.version}`,
  ];
  if (decision.decided_at !== undefined) {
    lines.push(`${indent}  decided_at: ${yamlQuote(decision.decided_at)}`);
  }
  lines.push(`${indent}  summary: ${yamlQuote(decision.summary)}`);
  lines.push(`${indent}  touched: ${yamlListValue(decision.touched)}`);
  return lines;
}

/**
 * Append a settled change to the model's decision ledger and bump
 * `model_version` (REQ-GM-003). This is the only mutation path; callers that
 * have no decision to record have no business writing the model (REQ-GM-004).
 * The edit is text-level so hand-authored YAML structure and comments survive;
 * new sections are appended at the end of the document when absent.
 */
export function applyDecision(
  modelPath: string,
  input: { summary: string; touched?: string[]; decided_at?: string },
): { decision: GameModelDecision; modelVersion: number } {
  const summary = input.summary.trim();
  if (summary.length === 0) {
    throw new GameModelLoadError("GAME_MODEL_SCHEMA_INVALID", modelPath, "decision summary is required");
  }

  const current = loadGameModel(modelPath);
  const nextN = current.decisions.reduce((max, d) => Math.max(max, d.n), 0) + 1;
  const nextVersion = current.modelVersion + 1;
  const decision: GameModelDecision = {
    n: nextN,
    version: nextVersion,
    decided_at: input.decided_at ?? new Date().toISOString(),
    summary,
    touched: input.touched ?? [],
  };

  const raw = readFileSync(modelPath, "utf8");
  let lines = raw.split("\n");

  const modelVersionIndex = lines.findIndex((l) => /^model_version:/.test(l));
  if (modelVersionIndex >= 0) {
    lines[modelVersionIndex] = `model_version: ${nextVersion}`;
  } else {
    lines.push(`model_version: ${nextVersion}`);
  }

  const decisionsIndex = lines.findIndex((l) => /^decisions:/.test(l));
  const entry = decisionEntryLines(decision, "  ");
  if (decisionsIndex >= 0) {
    const header = lines[decisionsIndex];
    if (/^decisions:\s*\S/.test(header)) {
      // Flow-style list (e.g. `decisions: []`): convert to block style in place.
      lines[decisionsIndex] = "decisions:";
      lines.splice(decisionsIndex + 1, 0, ...entry);
    } else {
      // Insert after the last item of the existing decisions list: scan forward
      // until a line at column 0 (next top-level key) or EOF.
      let insertAt = lines.length;
      for (let i = decisionsIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() !== "" && !line.startsWith(" ") && !line.startsWith("-")) {
          insertAt = i;
          break;
        }
      }
      lines.splice(insertAt, 0, ...entry);
    }
  } else {
    lines.push("decisions:");
    lines.push(...entry);
  }

  // Post-write validation: the only declared mutation path must never leave
  // the model unloadable; on failure the previous content is restored and the
  // error propagates (no corrupt-write-claims-success).
  const previous = raw;
  const updated = lines.join("\n");
  writeFileSync(modelPath, updated);
  try {
    loadGameModel(modelPath);
  } catch (error) {
    writeFileSync(modelPath, previous);
    throw new GameModelLoadError(
      "GAME_MODEL_SCHEMA_INVALID",
      modelPath,
      `decision write rejected because the resulting model failed to load: ${String(error)}`,
    );
  }
  return { decision, modelVersion: nextVersion };
}

export interface StampedDerivative {
  id: string;
  kind: "asset" | "recipe" | "evidence" | "other";
  source: string;
  stamp: DerivativeStamp | null;
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stampOf(record: Record<string, unknown>): DerivativeStamp | null {
  const result = DerivativeStampSchema.safeParse({ built_from: record.built_from, reads: record.reads ?? [] });
  return result.success ? result.data : null;
}

/**
 * Collect model-derived artifacts in a project that declare (or should declare)
 * derivative stamps (REQ-STALE-001): asset registry records, recipe project
 * content, and evidence manifests. Unstamped derivatives are reported as
 * `stamp: null` so the pressure to record provenance stays visible.
 */
export function collectDerivativeStamps(projectRoot: string): StampedDerivative[] {
  const root = projectRoot.replace(/\/$/, "");
  const found: StampedDerivative[] = [];

  const manifest = readJson(`${root}/assets/manifest.json`);
  if (manifest && Array.isArray(manifest.records)) {
    for (const record of manifest.records as Record<string, unknown>[]) {
      if (typeof record.id !== "string") continue;
      found.push({
        id: record.id,
        kind: "asset",
        source: "assets/manifest.json",
        stamp: stampOf(record),
      });
    }
  }

  const recipesDir = `${root}/.studio/recipes`;
  if (existsSync(recipesDir)) {
    for (const entry of Array.from(new Bun.Glob("*.json").scanSync({ cwd: recipesDir })).sort()) {
      const body = readJson(`${recipesDir}/${entry}`);
      if (!body) continue;
      const recipeId = typeof body.recipe_id === "string" ? body.recipe_id : entry.replace(/\.json$/, "");
      found.push({
        id: `recipe:${recipeId}`,
        kind: "recipe",
        source: `.studio/recipes/${entry}`,
        stamp: stampOf(body),
      });
    }
  }

  const runsDir = `${root}/artifacts/runs`;
  if (existsSync(runsDir)) {
    for (const run of Array.from(new Bun.Glob("*/manifest-*.json").scanSync({ cwd: runsDir })).sort()) {
      const body = readJson(`${runsDir}/${run}`);
      if (!body || typeof body.id !== "string") continue;
      found.push({
        id: `evidence:${body.id}`,
        kind: "evidence",
        source: `artifacts/runs/${run}`,
        stamp: stampOf(body),
      });
    }
  }

  return found;
}

export interface StalenessReportRow {
  id: string;
  kind: StampedDerivative["kind"];
  source: string;
  stamped: boolean;
  stale: boolean;
  staleReasons: number[];
  /** Reads that name no declared model section/extension/resource scope (REQ-GM-006). */
  absentReads: string[];
}

/**
 * Evaluate every collected derivative against the current model
 * (REQ-STALE-002..004). Pure with respect to its inputs; unstamped
 * derivatives are reported `stamped: false` and are never silently current.
 */
export function evaluateProjectStaleness(model: GameModel, derivatives: StampedDerivative[]): StalenessReportRow[] {
  const declared = {
    knownKeys: Object.keys(model.known),
    extensionKeys: Object.keys(model.extensions),
  };
  return derivatives.map((d) => {
    if (d.stamp === null) {
      return { id: d.id, kind: d.kind, source: d.source, stamped: false, stale: false, staleReasons: [], absentReads: [] };
    }
    const reasons = staleReasons(d.stamp, model.decisions);
    return {
      id: d.id,
      kind: d.kind,
      source: d.source,
      stamped: true,
      stale: reasons.length > 0,
      staleReasons: reasons,
      absentReads: absentReads(d.stamp.reads, declared),
    };
  });
}

export { touches, staleReasons };
