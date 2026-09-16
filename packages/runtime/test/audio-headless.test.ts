import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AudioSystem,
  GauntletKernel,
  NullAudioBackend,
  registerAudioSubsystem,
} from "../src/index";
import { AudioProjectionHandle, EntityId, Transform, Velocity } from "../src/state/traits";
import type { AudioBackend, AudioBackendState, AudioEventIntent, AudioPlaybackHandle } from "../src/audio";

const RUNTIME_SRC_DIR = join(import.meta.dir, "..", "src");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectSourceFiles(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Minimal moving-target gameplay simulation used to prove audio participates in gameplay
 * consequences without ever blocking or crashing semantics (headless-safe by construction).
 */
function runHeadlessGameplay(audio: AudioSystem, ticks: number): GauntletKernel {
  const kernel = new GauntletKernel({ mode: "headless" });
  kernel.barrier.register("physics", true);
  kernel.barrier.markBooting("physics");
  // Audio joins as an OPTIONAL subsystem; readiness never depends on it (REQ-SAFE-007).
  registerAudioSubsystem(kernel.barrier, audio.backend);
  kernel.barrier.markReady("physics", 1);

  const world = kernel.gameWorld;
  world.spawnEntity({
    id: "hero",
    transform: { position: [0, 0, 0] },
    velocity: { linear: [1, 0, 0] },
  });
  // Semantic audio intent carrier: an emitter entity whose trait flags a one-shot event.
  world.spawnEntity({ id: "emitter" });
  const emitter = world.getEntity("emitter");
  if (emitter) {
    emitter.add(
      AudioProjectionHandle({ handleId: "emitter-audio", soundEvent: "weapon.laser_fire", playing: true, volume: 0.8 })
    );
  }

  kernel.scheduler.registerStepHandler((tick) => {
    audio.observeTick(tick.tick);
    // Gameplay consequence -> audio intent through the abstraction ONLY.
    if (tick.tick === 10) {
      audio.emitSound({ soundEvent: "enemy.explode", volume: 1, position: [3, 0, 0] });
    }
    // Semantic trait drain -> backend intents.
    audio.syncFromState(world);
    // Integrate velocity (authoritative mutation).
    for (const entity of world.query(EntityId, Velocity, Transform)) {
      const v = entity.get(Velocity);
      const t = entity.get(Transform);
      if (v && t) {
        entity.set(Transform, {
          position: [t.position[0] + v.linear[0] * tick.dt, t.position[1], t.position[2]],
        });
      }
    }
  });

  kernel.barrier.startScenario(() => {
    for (let i = 0; i < ticks; i++) kernel.scheduler.stepSingleTick();
  });

  return kernel;
}

describe("AudioBackend boundary under headless conditions (T17 - REQ-BIND-012, REQ-AUDIO-002)", () => {
  it("imports and constructs NullAudioBackend with zero DOM, zero AudioContext, zero Tone.js", () => {
    // This test file runs under Bun with no DOM and no Web Audio: importing core game
    // logic must not require window.AudioContext (REQ-AUDIO-002).
    expect(typeof document).toBe("undefined");
    expect(typeof (globalThis as any).AudioContext).toBe("undefined");

    const backend = new NullAudioBackend();
    expect(backend.kind).toBe("null");
    expect(backend.isHeadless()).toBe(true);
    expect(backend.getState()).toBe("ready");
    expect(backend.isReady()).toBe(true);
  });

  it("NullAudioBackend unlock/suspend lifecycle and counted no-op playback", async () => {
    const backend = new NullAudioBackend();
    await expect(backend.unlock()).resolves.toBe("ready");

    const handle = backend.playSound({ soundEvent: "ui.click", volume: 0.5 });
    expect(handle.stopped).toBe(false);
    handle.stop();
    expect(handle.stopped).toBe(true);

    await backend.suspend();
    expect(backend.getState()).toBe("suspended");
    expect(backend.isReady()).toBe(false);
    // Suppressed while suspended: dead handle, no throw (REQ-SAFE-007).
    const suppressed = backend.playSound({ soundEvent: "ui.click" });
    expect(suppressed.stopped).toBe(true);

    // Drain the microtask that completes the natural one-shot.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backend.getDiagnostics()).toEqual({
      kind: "null",
      state: "suspended",
      is_headless: true,
      intents_played: 1,
      intents_suppressed: 1,
      active_handles: 0,
    });
  });

  it("TEETH-T17-002: headless simulation runs with no DOM and no AudioContext using the null backend", () => {
    // The attack: run headless server/tests with no DOM or AudioContext.
    // Expected: simulation passes using non-browser audio backend/no-op behavior.
    expect(typeof document).toBe("undefined");
    expect(typeof (globalThis as any).AudioContext).toBe("undefined");

    const audio = new AudioSystem(new NullAudioBackend());
    const kernel = runHeadlessGameplay(audio, 60);

    // Simulation passed and advanced normally.
    expect(kernel.scheduler.getTick()).toBe(60);
    const hero = kernel.gameWorld.getEntity("hero");
    const t = hero!.get(Transform)!;
    expect(t.position[0]).toBeCloseTo(1.0, 5); // 60 ticks * (1/60s) * 1 u/s

    // Audio intents participated as no-ops without crashing or blocking anything:
    // one trait drain at tick 1 plus one burst emission at tick 10.
    const log = audio.getEventLog();
    expect(log.length).toBe(2);
    expect(log.every((r) => !r.suppressed)).toBe(true);
    const diag = audio.getDiagnostics();
    expect(diag.kind).toBe("null");
    expect(diag.is_headless).toBe(true);
    expect(diag.intents_played).toBe(2);

    // Readiness never depended on audio (optional subsystem).
    expect(kernel.barrier.isReady()).toBe(true);
    kernel.dispose();
    // Release the Koota world id (global 16-world process cap).
    kernel.gameWorld.world.destroy();
  });

  it("TEETH-T17-002 (structural): packages/runtime has zero Tone.js/AudioContext dependencies anywhere in source", () => {
    const files = collectSourceFiles(RUNTIME_SRC_DIR);
    expect(files.length).toBeGreaterThan(10);

    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/from\s+["']tone["']|require\(["']tone["']\)|import\(["']tone["']\)/.test(text)) {
        violations.push(`tone import: ${file}`);
      }
      if (/new\s+AudioContext|window\.AudioContext|window\.webkitAudioContext|new\s+webkitAudioContext/.test(text)) {
        violations.push(`AudioContext usage: ${file}`);
      }
      if (/["']@gauntlet\/adapters["']/.test(text)) {
        violations.push(`runtime->adapters import: ${file}`);
      }
    }
    expect(violations).toEqual([]);

    const pkg = JSON.parse(readFileSync(join(RUNTIME_SRC_DIR, "..", "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps["tone"]).toBeUndefined();
  });

  it("core semantics carry no provider audio objects across the boundary (Koota purity)", () => {
    const audio = new AudioSystem(new NullAudioBackend());
    const kernel = runHeadlessGameplay(audio, 12);
    // GameWorld's guard rejects Tone/AudioContext/provider objects hidden in semantic data.
    expect(() => kernel.gameWorld.assertNoProviderObjectsInState()).not.toThrow();
    const snapshot = kernel.gameWorld.takeSemanticSnapshot();
    expect(snapshot.entities.length).toBe(2);
    expect(snapshot.entities.every((e) => typeof e.id === "string")).toBe(true);
    kernel.dispose();
    // Release the Koota world id (global 16-world process cap).
    kernel.gameWorld.world.destroy();
  });

  it("unavailable/misbehaving audio degrades without touching unrelated game logic (REQ-SAFE-007)", () => {
    // Hostile backend: permanently locked AND throws from playSound. Gameplay must not care.
    const hostile: AudioBackend = {
      kind: "hostile-test",
      isHeadless: () => false,
      getState: (): AudioBackendState => "locked",
      isReady: () => false,
      unlock: () => Promise.resolve<AudioBackendState>("locked"),
      suspend: () => Promise.resolve(),
      playSound: (_intent: AudioEventIntent): AudioPlaybackHandle => {
        throw new Error("autoplay policy hostile stub");
      },
      getDiagnostics: () => ({
        kind: "hostile-test",
        state: "locked" as const,
        is_headless: false,
        intents_played: 0,
        intents_suppressed: 0,
        active_handles: 0,
      }),
      dispose: () => {},
    };

    const audio = new AudioSystem(hostile);
    const kernel = runHeadlessGameplay(audio, 30);

    // Simulation completed despite a throwing, locked audio backend.
    expect(kernel.scheduler.getTick()).toBe(30);
    const hero = kernel.gameWorld.getEntity("hero");
    expect(hero!.get(Transform)!.position[0]).toBeCloseTo(0.5, 5);

    // All intents suppressed and logged as such.
    const log = audio.getEventLog();
    expect(log.length).toBe(2);
    expect(log.every((r) => r.suppressed)).toBe(true);
    kernel.dispose();
    // Release the Koota world id (global 16-world process cap).
    kernel.gameWorld.world.destroy();
  });
});
