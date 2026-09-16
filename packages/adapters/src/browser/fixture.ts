/**
 * Deterministic committed fixture scenario for the browser proof harness (T20/T21).
 *
 * This is a SELF-CONTAINED fixture page standing in for a real game title. It mounts
 * a `__GAUNTLET_STUDIO_OBS__` v1-shaped surface (header + every stable method) with
 * tiny deterministic "game semantics" behind it. The harness treats it exactly like
 * a real game: it validates the mounted surface against contract v1 and then reads
 * ONLY through stable methods. A real game mounts the real T19 bridge instead.
 *
 * Variants (via ?variant= query parameter or the served ?scenario= id):
 *   ok                          — semantic state and pixels agree: after N bounded
 *                                 fixed-steps the authoritative player position is x = N.
 *   wrong-state                 — TEETH-T20-001 fixture: rendered pixels remain visually
 *                                 correct (identical bytes) while the authoritative
 *                                 semantic snapshot reports the player stuck at x = 0.
 *   performance-fixture         — T21 healthy performance fixture: deterministic
 *                                 renderer identity (hardware-class) + renderer stats
 *                                 (draw calls, triangles, textures, fps, readiness, and
 *                                 a 40-sample frame-time distribution with p95 ≈ 19.6ms,
 *                                 p99 = 19.8ms) within the test-budget profile budgets.
 *   performance-fixture-regress — TEETH-T21-001 fixture: deliberate frame-time (p95 ≈
 *                                 56ms, p99 = 58ms) + draw-call (36 > 24) regression
 *                                 reported through the SAME stable stats seam while the
 *                                 canvas paint and semantic snapshot stay BYTE-IDENTICAL
 *                                 to performance-fixture. Pixels/semantics cannot mask
 *                                 the budget violation.
 *   performance-fixture-avg-only — TEETH-T21-002 fixture: reports only a HEALTHY average
 *                                 FPS (60) and no frame-time samples/percentiles;
 *                                 average-only reporting must fail the profile gate per
 *                                 the declared metric rules.
 *   performance-fixture-swiftshader — software-rendering guard fixture: healthy metrics
 *                                 but a SwiftShader-class renderer identity; hardware-
 *                                 sensitive evidence is non-target and can never settle
 *                                 a hardware-target profile.
 *
 * Determinism: no Date.now(), no Math.random(), no animations; the canvas is painted
 * once from fixed values and every reported metric is a fixed function of the variant,
 * so repeated captures of a variant are stable.
 */

export interface FixtureScenarioOptions {
  variant:
    | "ok"
    | "wrong-state"
    | "perf-ok"
    | "perf-regress"
    | "perf-avg-only"
    | "perf-swiftshader";
}

export function fixtureScenarioHtml(options: FixtureScenarioOptions): string {
  const variant = options.variant;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Gauntlet proof fixture</title>
<link rel="icon" href="data:,">
<style>
  html, body { margin: 0; padding: 0; background: #101418; }
  #scene { display: block; image-rendering: pixelated; }
  #hud {
    font: 12px monospace; color: #9fe08a; background: #101418;
    padding: 4px 8px; letter-spacing: 0.5px;
  }
</style>
</head>
<body>
<canvas id="scene" width="320" height="180"></canvas>
<div id="hud">GAUNTLET PROOF FIXTURE &mdash; SCENARIO OK &mdash; PLAYER AT CHECKPOINT</div>
<script>
(() => {
  "use strict";
  var CONTRACT_NAME = "__GAUNTLET_STUDIO_OBS__";
  var params = new URLSearchParams(location.search);
  function variantFromName(name) {
    if (!name) return null;
    if (/(^|[.\\-_])wrong([.\\-_]?state)|wrong-state/.test(name)) return "wrong-state";
    // Order matters: qualified performance ids before the bare performance fixture.
    if (/performance-fixture-regress|perf-regress/.test(name)) return "perf-regress";
    if (/performance-fixture-avg-only|avg-only/.test(name)) return "perf-avg-only";
    if (/performance-fixture-swiftshader|swiftshader/.test(name)) return "perf-swiftshader";
    if (/^performance-fixture$|perf-ok/.test(name)) return "perf-ok";
    return null;
  }
  // Variant comes from an explicit ?variant= param, from the scenario identity the
  // harness serves (?scenario=<scenario-id>), or defaults to "ok".
  var variant = variantFromName(params.get("variant") ?? params.get("scenario")) ?? (params.get("variant") === "ok" ? "ok" : null) ?? "ok";
  var STEPS_PER_CHECKPOINT = 3; // expectation: player.x === steps after step(steps)

  // Deterministic performance fixture table: every reported metric is a fixed
  // function of the variant (no clocks, no randomness).
  var PERF = {
    "perf-ok":          { draw_calls: 18, triangles: 420, textures: 3, resources: 7, fps_avg: 60, readiness_ms: 120, ft: [15.2, 19.8] },
    "perf-regress":     { draw_calls: 36, triangles: 420, textures: 3, resources: 7, fps_avg: 24, readiness_ms: 120, ft: [20.0, 58.0] },
    "perf-avg-only":    { draw_calls: 18, triangles: 420, textures: 3, resources: 7, fps_avg: 60, readiness_ms: 120, ft: null },
    "perf-swiftshader": { draw_calls: 18, triangles: 420, textures: 3, resources: 7, fps_avg: 60, readiness_ms: 120, ft: [15.2, 19.8] },
  };
  var IDENTITY = {
    "perf-ok":          "ANGLE (Deterministic Fixture GL, HardwareClass)",
    "perf-regress":     "ANGLE (Deterministic Fixture GL, HardwareClass)",
    "perf-avg-only":    "ANGLE (Deterministic Fixture GL, HardwareClass)",
    "perf-swiftshader": "SwiftShader (Deterministic Fixture SoftwareGL)",
  };

  var state = { steps: 0, seed: 0, paused: false, view: "main" };

  // Authoritative (simulated Koota) player x. In the wrong-state variant the
  // authoritative serialization drifts to 0 while the visual keeps looking correct.
  function authoritativePlayerX() { return state.steps * 1.0; }
  function serializedPlayerX() {
    return variant === "wrong-state" ? 0.0 : authoritativePlayerX();
  }

  function entityList() {
    return [
      {
        id: "player",
        transform: {
          position: [serializedPlayerX(), 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        tags: ["player"],
      },
      {
        id: "checkpoint-beacon",
        transform: {
          position: [STEPS_PER_CHECKPOINT * 1.0, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        tags: ["beacon"],
      },
    ];
  }

  function snapshot() {
    return { version: 1, timestamp: 0, entities: entityList() };
  }

  // Static deterministic painting: the player is drawn at the EXPECTED final
  // position in both the ok and wrong-state variants AND in every perf variant,
  // so pixels stay byte-identical while (wrong-state) semantics contradict the
  // frozen expectation or (perf-regress) the reported telemetry regresses.
  function paint() {
    var canvas = document.getElementById("scene");
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1c2b3a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#23412c";
    ctx.fillRect(0, 140, canvas.width, 40);
    var scale = 14;
    function draw(x, y, color) {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(20 + x * scale), Math.round(140 - y * scale) - 12, 12, 12);
    }
    draw(STEPS_PER_CHECKPOINT * 1.0, 0, "#c8b25e"); // checkpoint beacon at x=3
    draw(authoritativePlayerX(), 0, "#9fe08a");     // player visually at x=3
    ctx.strokeStyle = "#33506b";
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  }

  var control = {
    pause: function () { state.paused = true; },
    resume: function () { state.paused = false; },
    isPaused: function () { return state.paused; },
    step: function (ticks) {
      var n = Math.floor(Number(ticks) || 0);
      if (n < 1 || n > 240) throw new RangeError("control.step is bounded to [1, 240], got " + n);
      state.steps += n;
      return state.steps;
    },
    maxStepTicks: function () { return 240; },
    setSeed: function (seed) { state.seed = Math.floor(Number(seed) || 0); },
    seed: function () { return state.seed; },
    setView: function (name) {
      if (name === "main") { state.view = "main"; return true; }
      return false;
    },
    listScenarios: function () {
      return [
        "fixture-ok",
        "fixture-wrong-state",
        "performance-fixture",
        "performance-fixture-regress",
        "performance-fixture-avg-only",
        "performance-fixture-swiftshader",
      ];
    },
    resetScenario: function (name) {
      var v = variantFromName(typeof name === "string" ? name : null);
      if (v) variant = v; // scenario identity flows through the control namespace
      state.steps = 0;
      state.paused = false;
    },
    clearErrors: function () { /* error ring is empty by construction */ },
  };

  var notWired = function (what) {
    return function () { return { present: false, reason: "fixture: " + what + " not wired" }; };
  };

  function deterministicFrameTimeSamples(range) {
    // Uniform spread across [lo, hi]; every sample is a fixed function of the index.
    var samples = [];
    for (var i = 0; i < 40; i++) {
      samples.push(Math.round((range[0] + (range[1] - range[0]) * (i / 39)) * 1000) / 1000);
    }
    return samples;
  }

  var surface = {
    contract: {
      name: CONTRACT_NAME,
      version: 1,
      mode: "test",
      readonly: false,
      privileged_control: true,
    },
    ready: function () { return true; },
    readiness: function () {
      return {
        state: "ready",
        required_subsystems: ["simulation"],
        subsystem_states: { simulation: "ready" },
      };
    },
    tick: function () {
      return {
        tick: state.steps,
        time: state.steps / 60,
        running: !state.paused,
        paused: state.paused,
        fixed_delta_time: 1 / 60,
        alpha: 0,
      };
    },
    entities: {
      list: function () { return entityList().map(function (e) { return e.id; }); },
      get: function (id) {
        var found = entityList().filter(function (e) { return e.id === id; })[0];
        return found ? { id: id, source: "koota", state: found } : { id: id, source: "koota", state: null };
      },
      snapshot: snapshot,
    },
    errors: { recent: function () { return []; } },
    renderer: {
      probe: function () {
        var identity = IDENTITY[variant];
        if (!identity) return { present: false, reason: "fixture: no WebGL renderer mounted" };
        return {
          present: true,
          identity: { unmasked_renderer: identity, vendor: "gauntlet-fixture" },
          capabilities: { max_texture_size: 2048 },
        };
      },
      stats: function () {
        var perf = PERF[variant];
        if (!perf) return { present: false, reason: "fixture: no renderer stats for this variant" };
        var stats = {
          draw_calls: perf.draw_calls,
          triangles: perf.triangles,
          textures: perf.textures,
          resources: perf.resources,
          fps_avg: perf.fps_avg,
          readiness_ms: perf.readiness_ms,
        };
        if (perf.ft) {
          var samples = deterministicFrameTimeSamples(perf.ft);
          stats.frame_time_samples_ms = samples;
          stats.frame_time_sample_count = samples.length;
        }
        // avg-only variant deliberately reports NO samples/percentiles: the healthy
        // average alone must never satisfy a profile that declares percentile rules.
        return { present: true, stats: stats };
      },
      capture: function () { return { preserveDrawingBuffer: false, purpose: "capture-only" }; },
    },
    physics: { read: notWired("physics") },
    navigation: { read: notWired("navigation") },
    spatial: { read: notWired("spatial") },
    network: { read: notWired("network") },
    views: {
      list: function () { return ["main"]; },
      get: function (name) {
        return name === "main" ? { name: "main", position: [0, 8, 14], target: [1.5, 0, 0], fov: 60 } : null;
      },
      current: function () {
        return state.view === "main" ? { name: "main", position: [0, 8, 14], target: [1.5, 0, 0], fov: 60 } : null;
      },
    },
    control: control,
  };

  // Immutable mount, mirroring the real bridge's surface discipline.
  Object.defineProperty(globalThis, CONTRACT_NAME, {
    value: Object.freeze(surface),
    writable: false,
    enumerable: true,
    configurable: false,
  });

  paint();
})();
</script>
</body>
</html>
`;
}

/** Scenario definitions exported for the CLI, tests, and the browser gate script. */
export const FIXTURE_OK_SCENARIO_ID = "fixture-ok";
export const FIXTURE_WRONG_STATE_SCENARIO_ID = "fixture-wrong-state";
export const PERFORMANCE_OK_SCENARIO_ID = "performance-fixture";
export const PERFORMANCE_REGRESS_SCENARIO_ID = "performance-fixture-regress";
export const PERFORMANCE_AVG_ONLY_SCENARIO_ID = "performance-fixture-avg-only";
export const PERFORMANCE_SWIFTSHADER_SCENARIO_ID = "performance-fixture-swiftshader";

const SCENARIO_VARIANTS: Record<string, FixtureScenarioOptions["variant"]> = {
  [FIXTURE_OK_SCENARIO_ID]: "ok",
  [FIXTURE_WRONG_STATE_SCENARIO_ID]: "wrong-state",
  [PERFORMANCE_OK_SCENARIO_ID]: "perf-ok",
  [PERFORMANCE_REGRESS_SCENARIO_ID]: "perf-regress",
  [PERFORMANCE_AVG_ONLY_SCENARIO_ID]: "perf-avg-only",
  [PERFORMANCE_SWIFTSHADER_SCENARIO_ID]: "perf-swiftshader",
};

export function buildFixtureScenario(
  scenarioId: string,
  opts: { seed?: number; steps?: number; view?: string; viewport?: { width: number; height: number } } = {}
): import("./types").ScenarioDefinition {
  const variant = SCENARIO_VARIANTS[scenarioId];
  if (!variant) {
    throw new Error(
      `unknown fixture scenario '${scenarioId}'; available: ${Object.keys(SCENARIO_VARIANTS).join(", ")}`
    );
  }
  return {
    id: scenarioId,
    html: fixtureScenarioHtml({ variant }),
    seed: opts.seed ?? 1337,
    steps: opts.steps ?? 3,
    view: opts.view ?? "main",
    viewport: opts.viewport ?? { width: 640, height: 360 },
  };
}
