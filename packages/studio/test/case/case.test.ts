import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGameModel } from "../../src/model/model";
import { evaluateQualityBar, deriveReleaseMatrix, QualityBarError, type QualityEvidenceRow, type ReleaseEvidenceRow } from "../../src/quality/bar";
import { deriveGameCase, type GameCaseInput } from "../../src/case/case";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "gauntlet-case-"));
}

function writeModel(root: string, body: string): string {
  const dir = join(root, ".agents", "specs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "game.spec.yaml");
  writeFileSync(path, body);
  return path;
}

function buildModel(body: string) {
  const root = tmpProject();
  const model = loadGameModel(writeModel(root, body));
  return { model, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const MODEL_BODY = `schema: gauntlet.game.model
schema_version: "2.0"
model_version: 1
identity:
  game_id: "case-game"
  title: "Case Game"
decisions:
  - n: 1
    version: 1
    summary: "initial case-game direction"
    touched: ["identity", "core_loop"]
fantasy: "survive the relay"
core_loop:
  summary: "land, repair, hold"
quality_bar:
  criteria:
    - id: locomotion-feel
      dimension: player-feel
      requirement: "movement is responsive within 100ms input latency"
      evidence_refs: ["settlement-locomotion"]
    - id: art-coherence
      dimension: visual
      requirement: "no obvious asset-pack seams in the vertical slice"
      evidence_refs: ["manifest-art-review"]
    - id: frame-budget
      dimension: technical
      requirement: "60fps p95 on target hardware"
      evidence_refs: ["settlement-perf"]
    - id: store-compliance
      dimension: release
      requirement: "store listing prerequisites met"
      not_applicable_reason: "web distribution only; no store"
    - id: save-resume
      dimension: ux
      requirement: "session resume restores state"
      evidence_refs: ["settlement-save"]
contradictions:
  - id: contr-001
    text: "camera section contradicts the third-person requirement in art-coherence evidence"
unknowns:
  - id: u1
    question: "does the relay mechanic hold attention past minute five?"
    status: open
`;

function caseInput(model: ReturnType<typeof loadGameModel>, overrides: Partial<GameCaseInput> = {}): GameCaseInput {
  return {
    model,
    staleness: [],
    quality: evaluateQualityBar(model, evidence),
    release: deriveReleaseMatrix({ model, declaredTargets: ["web", "godot.android"], evidence: releaseEvidence }),
    resourceGaps: [],
    ...overrides,
  };
}

const evidence: QualityEvidenceRow[] = [
  { id: "settlement-locomotion", requirement_ids: ["REQ-VERIFY-001"], decision: "settled", result: "pass" },
  { id: "manifest-art-review", requirement_ids: ["REQ-VERIFY-002"], decision: "failed", result: "fail" },
  { id: "settlement-perf", requirement_ids: ["REQ-VERIFY-003"], decision: "settled", result: "pass", stale: true },
  { id: "settlement-save", requirement_ids: ["REQ-VERIFY-004"], decision: "blocked", result: "blocked" },
];

const releaseEvidence: ReleaseEvidenceRow[] = [
  {
    id: "settlement-web-perf",
    requirement_ids: ["REQ-PERF-001"],
    decision: "settled",
    result: "pass",
    target: "web",
    dimension: "performance",
  },
  {
    id: "settlement-swiftshader-perf",
    requirement_ids: ["REQ-PERF-001"],
    decision: "settled",
    result: "pass",
    target: "godot.android",
    dimension: "performance",
    environment: { renderer: "SwiftShader" },
    non_target: true,
  },
];

describe("professional quality bar (REQ-QUAL-001..002)", () => {
  test("states derive from evidence: pass, fail, attention, unknown, not-applicable", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const evaluation = evaluateQualityBar(model, evidence);
    const byId = Object.fromEntries(evaluation.rows.map((r) => [r.criterion_id, r]));
    expect(byId["locomotion-feel"].state).toBe("pass");
    expect(byId["locomotion-feel"].evidence).toEqual(["settlement-locomotion"]);
    expect(byId["art-coherence"].state).toBe("fail");
    expect(byId["frame-budget"].state).toBe("attention"); // stale evidence
    expect(byId["save-resume"].state).toBe("attention"); // blocked evidence
    expect(byId["store-compliance"].state).toBe("not-applicable");
    expect(byId["store-compliance"].reason).toContain("web distribution");
    cleanup();
  });

  test("pass always carries evidence; unknown stays unknown", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const evaluation = evaluateQualityBar(model, []);
    for (const row of evaluation.rows) {
      if (row.state === "pass") throw new Error(`pass without evidence: ${row.criterion_id}`);
      if (row.state === "unknown") expect(row.evidence).toEqual([]);
    }
    expect(evaluation.rows.every((r) => r.state === "unknown" || r.state === "not-applicable")).toBe(true);
    cleanup();
  });

  test("no numeric score exists anywhere in the evaluation", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const evaluation = evaluateQualityBar(model, evidence);
    const serialized = JSON.stringify(evaluation);
    expect(/"score"|"aaa"|"percentage"|percent/.test(serialized)).toBe(false);
    cleanup();
  });

  test("a model without a declared quality bar is an error, not an assumed bar", () => {
    const { model, cleanup } = buildModel(MODEL_BODY.replace(/quality_bar:[\s\S]*?contradictions:/, "contradictions:"));
    expect(() => evaluateQualityBar(model, evidence)).toThrow(QualityBarError);
    cleanup();
  });
});

describe("release matrix (REQ-RELEASE-001..003)", () => {
  test("targets settle independently: web pass never settles android", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const matrix = deriveReleaseMatrix({ model, declaredTargets: ["web", "godot.android"], evidence: releaseEvidence });
    const web = matrix.targets.find((t) => t.target === "web")!;
    const android = matrix.targets.find((t) => t.target === "godot.android")!;
    const webPerf = web.dimensions.find((d) => d.dimension === "performance")!;
    const androidPerf = android.dimensions.find((d) => d.dimension === "performance")!;
    expect(webPerf.state).toBe("pass");
    expect(androidPerf.state).toBe("blocked"); // only SwiftShader evidence exists
    expect(androidPerf.reason).toContain("non-target");
    cleanup();
  });

  test("software-rendered evidence cannot settle a hardware-bound target (REQ-RELEASE-003)", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const swiftshaderOnly: ReleaseEvidenceRow[] = [
      {
        id: "swiftshader-run",
        requirement_ids: ["REQ-PERF-001"],
        decision: "settled",
        result: "pass",
        target: "godot.android",
        dimension: "visual-quality",
        environment: { renderer: "SwiftShader" },
        non_target: true,
      },
    ];
    const matrix = deriveReleaseMatrix({ model, declaredTargets: ["godot.android"], evidence: swiftshaderOnly });
    const android = matrix.targets.find((t) => t.target === "godot.android")!;
    const visual = android.dimensions.find((d) => d.dimension === "visual-quality")!;
    expect(visual.state).toBe("blocked");
    expect(android.settlement).not.toBe("settled");
    cleanup();
  });

  test("declared not-applicable dimensions carry reasons and do not block settlement", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const fullEvidence: ReleaseEvidenceRow[] = (["build", "core-loop", "scenarios", "visual-quality", "animation", "audio", "ui-ux", "performance", "input", "startup", "crash-error-state", "packaging", "platform-specific"] as const).map((dimension, i) => ({
      id: `ev-${i}`,
      requirement_ids: ["REQ-X"],
      decision: "settled" as const,
      result: "pass" as const,
      target: "web",
      dimension,
    }));
    const matrix = deriveReleaseMatrix({ model, declaredTargets: ["web"], evidence: fullEvidence });
    const web = matrix.targets.find((t) => t.target === "web")!;
    expect(web.dimensions.find((d) => d.dimension === "signing")!.state).toBe("unknown");
    expect(web.settlement).toBe("unsettled");
    cleanup();
  });

  test("failing dimension blocks target settlement", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const withFailure: ReleaseEvidenceRow[] = [
      { id: "fail-build", requirement_ids: ["REQ-X"], decision: "failed", result: "fail", target: "web", dimension: "build" },
    ];
    const matrix = deriveReleaseMatrix({ model, declaredTargets: ["web"], evidence: withFailure });
    const web = matrix.targets.find((t) => t.target === "web")!;
    expect(web.dimensions.find((d) => d.dimension === "build")!.state).toBe("fail");
    expect(web.settlement).toBe("unsettled");
    cleanup();
  });
});

describe("Game Case derivation (REQ-CASE-001..003)", () => {
  test("answers destination, current, material deviation, primary move, alternatives, blocked", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const gameCase = deriveGameCase(caseInput(model));
    expect(gameCase.authoritative).toBe(false);
    expect(gameCase.destination.text).toBe("land, repair, hold");
    expect(gameCase.destination.release_bar).toContain("quality criteria");
    expect(gameCase.current).toContain("model@1");
    // Contradictions rank first among interrupt-severity deviations; the
    // primary move resolves the material deviation deterministically.
    expect(gameCase.material?.kind).toBe("contradiction");
    expect(gameCase.primary_move!.id).toBe("resolve-contradiction:contr-001");
    expect(gameCase.deviations.some((d) => d.kind === "quality-gap" && d.severity === "interrupt")).toBe(true);
    expect(gameCase.primary_move).not.toBeNull();
    expect(gameCase.primary_move!.lane).toBe("next-move");
    expect(gameCase.alternatives.length).toBeGreaterThan(0);
    expect(gameCase.blocked.length).toBeGreaterThan(0);
    cleanup();
  });

  test("primary move resolves the material deviation (leverage ordering)", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const gameCase = deriveGameCase(caseInput(model));
    // Material deviation (contradiction) is resolved by the primary move.
    expect(gameCase.primary_move!.id.startsWith("resolve-contradiction:")).toBe(true);
    const leverages = gameCase.alternatives.map((m) => m.leverage);
    expect([...leverages].sort((a, b) => a - b)).toEqual(leverages);
    cleanup();
  });

  test("contradictions outrank optimistic progress", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const gameCase = deriveGameCase(
      caseInput(model, {
        quality: evaluateQualityBar(model, [
          { id: "settlement-locomotion", requirement_ids: [], decision: "settled", result: "pass" },
          { id: "manifest-art-review", requirement_ids: [], decision: "settled", result: "pass" },
          { id: "settlement-perf", requirement_ids: [], decision: "settled", result: "pass" },
          { id: "settlement-save", requirement_ids: [], decision: "settled", result: "pass" },
        ]),
      }),
    );
    // All criteria pass but the contradiction still interrupts.
    expect(gameCase.deviations.some((d) => d.kind === "contradiction" && d.severity === "interrupt")).toBe(true);
    const primary = gameCase.primary_move!;
    expect(primary.id).toBe("resolve-contradiction:contr-001");
    cleanup();
  });

  test("blocked moves are never recommended as reachable", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const gameCase = deriveGameCase(caseInput(model));
    for (const blocked of gameCase.blocked) {
      expect(blocked.lane).toBe("blocked");
      expect(blocked.blocked_by?.length ?? 0).toBeGreaterThan(0);
      expect(gameCase.primary_move?.id).not.toBe(blocked.id);
      expect(gameCase.alternatives.map((m) => m.id)).not.toContain(blocked.id);
    }
    cleanup();
  });

  test("release verdict is never silently decided (REQ-CASE-003)", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const gameCase = deriveGameCase(caseInput(model));
    expect(gameCase.settlement.reachable).toBe(false);
    expect(gameCase.settlement.note).toContain("owner");
    expect(JSON.stringify(gameCase).match(/"verdict"\s*:\s*"(release|go|ship)/i)).toBeNull();
    cleanup();
  });

  test("the case is stored nowhere: pure function of its inputs", () => {
    const { model, cleanup } = buildModel(MODEL_BODY);
    const a = deriveGameCase(caseInput(model));
    const b = deriveGameCase(caseInput(model));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    cleanup();
  });
});
