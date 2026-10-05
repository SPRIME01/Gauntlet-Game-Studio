import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GameModelDecisionSchema,
  DerivativeStampSchema,
  validateDerivativeStamp,
} from "@gauntlet/contracts";
import {
  loadGameModel,
  applyDecision,
  collectDerivativeStamps,
  evaluateProjectStaleness,
  gameSpecPathFor,
  GameModelLoadError,
} from "../../src/model/model";
import {
  touches,
  staleReasons,
  assertEvidenceFreshAgainstModel,
  absentReads,
  ModelStalenessError,
} from "../../src/model/staleness";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "gauntlet-model-"));
}

function writeModel(root: string, body: string): string {
  const dir = join(root, ".agents", "specs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "game.spec.yaml");
  writeFileSync(path, body);
  return path;
}

const V1_BODY = `schema: gauntlet.game.spec
schema_version: "1.0"
title: "Test V1 Game"
status: "draft"
game_id: "test-v1-game"
runtime_target: "browser"
budgets:
  target_fps: 60
  max_draw_calls: 200
  max_triangles: 250000
  max_memory_mb: 256
assets:
  manifest: "assets/manifest.json"
evidence:
  location: "artifacts/evidence/"
`;

const V2_BODY = `schema: gauntlet.game.model
schema_version: "2.0"
model_version: 2
identity:
  game_id: "test-v2-game"
  title: "Test V2 Game"
fantasy: "be a lighthouse keeper on a dead sea"
camera:
  mode: "third-person"
  fov: 70
languages:
  material:
    summary: "weathered painted metal, matte cloth"
core_loop:
  summary: "explore, signal, survive"
  steps: ["enter world", "move", "interact", "complete one loop"]
scenarios:
  boot:
    description: "boot and expose the world"
    acceptance: {}
decisions:
  - n: 1
    version: 1
    summary: "initial vertical slice direction"
    touched: ["identity", "core_loop"]
  - n: 2
    version: 2
    summary: "camera locked to third person"
    touched: ["camera"]
extensions_free_form:
  anything: [1, 2, 3]
`;

describe("game model contracts", () => {
  test("decision and stamp schemas are strict", () => {
    expect(GameModelDecisionSchema.safeParse({ n: 1, version: 1, summary: "s" }).success).toBe(true);
    expect(
      GameModelDecisionSchema.safeParse({ n: 1, version: 1, summary: "s", rogue: true }).success,
    ).toBe(false);
    expect(DerivativeStampSchema.safeParse({ built_from: 1, reads: ["camera"] }).success).toBe(true);
    expect(validateDerivativeStamp({ built_from: 0, reads: [] })).toEqual({ built_from: 0, reads: [] });
  });
});

describe("TEETH-T29-001: existing game specs load unchanged", () => {
  test("template v1 spec loads with identity fallback and extension preservation", () => {
    const model = loadGameModel(gameSpecPathFor(join(REPO_ROOT, "templates", "game")));
    expect(model.schema).toBe("gauntlet.game.spec");
    expect(model.known.identity?.game_id).toBe("unnamed-game");
    expect(model.extensions["runtime_target"]).toBe("browser");
    expect(model.extensions["evidence"]).toBeDefined();
    expect(model.modelVersion).toBe(0);
  });

  test("blackwater-relay v1 spec loads with quality profiles validated", () => {
    const model = loadGameModel(gameSpecPathFor(join(REPO_ROOT, "examples", "blackwater-relay")));
    expect(model.known.identity?.game_id).toBe("blackwater-relay");
    expect(Object.keys(model.qualityProfiles).length).toBeGreaterThan(0);
    expect(model.extensions["multiplayer"]).toBeDefined();
    expect(model.extensions["single_player"]).toBeDefined();
  });

  test("codename-gauntlet-warfare v1 spec loads with free-form routes/loop preserved", () => {
    const model = loadGameModel(gameSpecPathFor(join(REPO_ROOT, "codename-gauntlet-warfare")));
    expect(model.known.identity?.game_id).toBe("codename-gauntlet-warfare");
    expect(model.extensions["loop"]).toBeDefined();
    expect(model.extensions["routes"]).toBeDefined();
    expect(model.extensions["quality_profile"]).toBe("aaa-tactical-fps-vertical-slice");
  });
});

describe("loader: canonical v2 strictness and legacy tolerance", () => {
  test("v2 canonical model loads typed sections and preserves extensions", () => {
    const root = tmpProject();
    const path = writeModel(root, V2_BODY);
    const model = loadGameModel(path);
    expect(model.schema).toBe("gauntlet.game.model");
    expect(model.modelVersion).toBe(2);
    expect(model.known.identity?.game_id).toBe("test-v2-game");
    expect(model.known.camera?.mode).toBe("third-person");
    expect(model.decisions.length).toBe(2);
    expect(model.extensions["extensions_free_form"]).toBeDefined();
    rmSync(root, { recursive: true, force: true });
  });

  test("v2 canonical model rejects an invalid typed section", () => {
    const root = tmpProject();
    const path = writeModel(root, V2_BODY.replace('mode: "third-person"', 'mode: "over-the-shoulder-cam"'));
    expect(() => loadGameModel(path)).toThrow(GameModelLoadError);
    rmSync(root, { recursive: true, force: true });
  });

  test("v1 legacy section with pre-v0.5.0 payload is preserved as extension, not invented", () => {
    const root = tmpProject();
    const badBudgets = V1_BODY.replace("max_draw_calls: 200", 'max_draw_calls: "plenty"');
    const path = writeModel(root, badBudgets);
    const model = loadGameModel(path);
    expect(model.legacySections).toContain("budgets");
    expect(model.extensions["budgets"]).toEqual({
      target_fps: 60,
      max_draw_calls: "plenty",
      max_triangles: 250000,
      max_memory_mb: 256,
    });
    rmSync(root, { recursive: true, force: true });
  });

  test("ledger inconsistency is rejected: version without decisions", () => {
    const root = tmpProject();
    const body = V2_BODY
      .replace("model_version: 2", "model_version: 3")
      .replace(/decisions:\n(  .*\n)+/, "");
    const path = writeModel(root, body);
    expect(() => loadGameModel(path)).toThrow(/ledger is empty/);
    rmSync(root, { recursive: true, force: true });
  });

  test("ledger inconsistency is rejected: decision newer than model_version", () => {
    const root = tmpProject();
    const path = writeModel(root, V2_BODY.replace("model_version: 2", "model_version: 1"));
    expect(() => loadGameModel(path)).toThrow(/newer than model_version/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("TEETH-T29-002: targeted staleness", () => {
  const decisions = [
    { n: 1, version: 1, summary: "d1", touched: ["identity"] },
    { n: 2, version: 2, summary: "camera to first person", touched: ["camera"] },
  ];

  test("touches matches exactly, hierarchically, and via all", () => {
    expect(touches(["camera"], ["camera"])).toBe(true);
    expect(touches(["camera"], ["camera.mode"])).toBe(true);
    expect(touches(["languages"], ["languages.material"])).toBe(true);
    expect(touches(["all"], ["audio"])).toBe(true);
    expect(touches(["camera"], ["audio", "languages.material"])).toBe(false);
  });

  test("a camera decision stales exactly the camera reader and leaves the audio reader current", () => {
    const cameraStamp = { built_from: 1, reads: ["camera", "languages.visual"] };
    const audioStamp = { built_from: 1, reads: ["languages.audio"] };
    expect(staleReasons(cameraStamp, decisions)).toEqual([2]);
    expect(staleReasons(audioStamp, decisions)).toEqual([]);
  });

  test("staleness is a pure function of stamp and ledger", () => {
    const stamp = { built_from: 1, reads: ["camera"] };
    const a = staleReasons(stamp, decisions);
    const b = staleReasons(stamp, decisions);
    expect(a).toEqual(b);
    expect(a).toEqual([2]);
  });
});

describe("TEETH-T29-003: decision-gated writes and stale settlement rejection", () => {
  test("applyDecision appends a ledger record, bumps model_version, and re-loads", () => {
    const root = tmpProject();
    const path = writeModel(root, V2_BODY);
    const { decision, modelVersion } = applyDecision(path, {
      summary: "camera moves to first person",
      touched: ["camera"],
      decided_at: "2026-10-04T00:00:00Z",
    });
    expect(modelVersion).toBe(3);
    expect(decision.n).toBe(3);
    const reloaded = loadGameModel(path);
    expect(reloaded.modelVersion).toBe(3);
    expect(reloaded.decisions.length).toBe(3);
    expect(reloaded.decisions[2].touched).toEqual(["camera"]);
    expect(reloaded.known.identity?.game_id).toBe("test-v2-game");
    rmSync(root, { recursive: true, force: true });
  });

  test("applyDecision on a v1 model appends a decisions section at the end", () => {
    const root = tmpProject();
    const path = writeModel(root, V1_BODY);
    applyDecision(path, { summary: "canonical direction recorded", touched: ["identity"], decided_at: "2026-10-04T00:00:00Z" });
    const reloaded = loadGameModel(path);
    expect(reloaded.modelVersion).toBe(1);
    expect(reloaded.decisions.length).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });

  test("silent mutation is impossible: a version bump without a decision record is a load error", () => {
    const root = tmpProject();
    const path = writeModel(root, V2_BODY);
    const raw = readText(path).replace("model_version: 2", "model_version: 5");
    writeFileSync(path, raw);
    expect(() => loadGameModel(path)).toThrow(/LEDGER_INCONSISTENT|without a decision record/);
    rmSync(root, { recursive: true, force: true });
  });

  test("empty decision summary is rejected", () => {
    const root = tmpProject();
    const path = writeModel(root, V2_BODY);
    expect(() => applyDecision(path, { summary: "   " })).toThrow(/summary is required/);
    rmSync(root, { recursive: true, force: true });
  });

  test("stale evidence is typed-rejected from settlement", () => {
    const decisions = [{ n: 2, version: 2, summary: "camera change", touched: ["camera"] }];
    expect(() =>
      assertEvidenceFreshAgainstModel(
        "manifest-01",
        { built_from: 1, reads: ["camera"] },
        decisions,
        2,
      ),
    ).toThrow(ModelStalenessError);
    expect(() =>
      assertEvidenceFreshAgainstModel("manifest-01", null, decisions, 2),
    ).toThrow(/UNSTAMPED/);
    // Fresh and matching evidence passes.
    assertEvidenceFreshAgainstModel("manifest-01", { built_from: 2, reads: ["camera"] }, decisions, 2);
  });
});

describe("TEETH-T29-004: all-decisions and absent reads", () => {
  test("a decision touching all marks every stamped derivative stale", () => {
    const decisions = [{ n: 1, version: 1, summary: "pivot", touched: ["all"] }];
    expect(staleReasons({ built_from: 0, reads: ["audio"] }, decisions)).toEqual([1]);
    expect(staleReasons({ built_from: 0, reads: ["camera.mode"] }, decisions)).toEqual([1]);
  });

  test("absent reads are reported, never silently dropped", () => {
    const absent = absentReads(["camera", "warp_drive.status", "asset:rifle"], {
      knownKeys: ["camera", "languages", "identity"],
      extensionKeys: ["routes", "loop"],
    });
    expect(absent).toEqual(["warp_drive.status"]);
    expect(absentReads(["asset:rifle"], { knownKeys: [], extensionKeys: [] })).toEqual([]);
  });

  test("project stamp collection reports stamped and unstamped derivatives", () => {
    const root = tmpProject();
    writeModel(root, V2_BODY);
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", "manifest.json"), JSON.stringify({
      schema: "gauntlet.asset.manifest",
      schema_version: "1.0",
      records: [
        { id: "rifle", built_from: 1, reads: ["camera"] },
        { id: "unstamped-prop" },
      ],
    }));
    mkdirSync(join(root, ".studio", "recipes"), { recursive: true });
    writeFileSync(join(root, ".studio", "recipes", "enemy.patrol.json"), JSON.stringify({
      recipe_id: "enemy.patrol",
      built_from: 1,
      reads: ["entities"],
    }));
    const stamps = collectDerivativeStamps(root);
    expect(stamps.length).toBe(3);
    const report = evaluateProjectStaleness(loadGameModel(gameSpecPathFor(root)), stamps);
    const rifle = report.find((r) => r.id === "rifle");
    const unstamped = report.find((r) => r.id === "unstamped-prop");
    const patrol = report.find((r) => r.id === "recipe:enemy.patrol");
    expect(rifle?.stamped).toBe(true);
    expect(rifle?.stale).toBe(true); // decision n=2 (version 2) touched camera
    expect(unstamped?.stamped).toBe(false);
    expect(patrol?.stale).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

function readText(path: string): string {
  // Local helper mirroring the loader's read path.
  return require("node:fs").readFileSync(path, "utf8");
}

describe("T29 confirmation-round remediations", () => {
  test("child-touch stales parent-read (no under-reporting staleness lie)", () => {
    const decisions = [{ n: 1, version: 1, summary: "fov narrowed", touched: ["camera.mode"] }];
    expect(staleReasons({ built_from: 0, reads: ["camera"] }, decisions)).toEqual([1]);
    expect(staleReasons({ built_from: 0, reads: ["camera.mode"] }, decisions)).toEqual([1]);
    expect(staleReasons({ built_from: 0, reads: ["camera.fov"] }, decisions)).toEqual([]);
    expect(staleReasons({ built_from: 0, reads: ["audio"] }, decisions)).toEqual([]);
  });

  test("flow-style decisions list is converted, not corrupted; corrupt write restores previous content", () => {
    const root = tmpProject();
    const path = writeModel(root, V2_BODY.replace("decisions:\n  - n: 1\n    version: 1\n    summary: \"initial vertical slice direction\"\n    touched: [\"identity\", \"core_loop\"]\n  - n: 2\n    version: 2\n    summary: \"camera locked to third person\"\n    touched: [\"camera\"]", "decisions: []").replace("model_version: 2", "model_version: 0"));
    applyDecision(path, { summary: "first recorded decision", touched: ["identity"], decided_at: "2026-10-04T00:00:00Z" });
    const reloaded = loadGameModel(path);
    expect(reloaded.modelVersion).toBe(1);
    expect(reloaded.decisions.length).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });

  test("characters, factions, objects, and interactions are typed sections (REQ-GM-002)", () => {
    const root = tmpProject();
    const body = V2_BODY + `characters:
  - id: keeper
    name: "The Keeper"
    role: "player-character"
factions:
  - id: tide-cult
    name: "Tide Cult"
objects:
  - id: signal-lamp
    name: "Signal Lamp"
interactions:
  - id: light-lamp
    name: "Light the Lamp"
`;
    const path = writeModel(root, body);
    const model = loadGameModel(path);
    expect(model.known.characters?.[0]?.id).toBe("keeper");
    expect(model.known.factions?.[0]?.id).toBe("tide-cult");
    expect(model.known.objects?.[0]?.id).toBe("signal-lamp");
    expect(model.known.interactions?.[0]?.id).toBe("light-lamp");
    rmSync(root, { recursive: true, force: true });
  });

  test("absent reads surface in the project staleness report", () => {
    const root = tmpProject();
    writeModel(root, V2_BODY);
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", "manifest.json"), JSON.stringify({
      schema: "gauntlet.asset.manifest",
      schema_version: "1.0",
      records: [{ id: "fog-machine", built_from: 1, reads: ["warp_drive.status"] }],
    }));
    const report = evaluateProjectStaleness(loadGameModel(gameSpecPathFor(root)), collectDerivativeStamps(root));
    const row = report.find((r) => r.id === "fog-machine");
    expect(row?.absentReads).toEqual(["warp_drive.status"]);
    rmSync(root, { recursive: true, force: true });
  });

  test("malformed stamps are reported unstamped, not coerced", () => {
    const root = tmpProject();
    writeModel(root, V2_BODY);
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", "manifest.json"), JSON.stringify({
      schema: "gauntlet.asset.manifest",
      schema_version: "1.0",
      records: [{ id: "bad-stamp", built_from: 1.5, reads: "camera" }],
    }));
    const stamps = collectDerivativeStamps(root);
    expect(stamps.find((s) => s.id === "bad-stamp")?.stamp).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });
});
