#!/usr/bin/env bun
/**
 * Headless scenario progression checks (T22) — run as a SCRIPT (child process) so the
 * per-process Koota world budget stays isolated from the studio's root test run.
 * Invoked by tests/scenarios-headless.test.ts (thin wrapper).
 *
 * The checks drive the SAME authoritative core the browser runs, without DOM, WebGL,
 * or AudioContext (REQ-AUDIO-002).
 */

import { bootHeadlessGame, disposeHeadlessGame, type HeadlessGame } from "../src/game/headless";
import { LAYOUT, SIMULATION } from "../src/game/config";

function expect(actual: unknown): {
  toBe: (v: unknown) => void;
  toBeCloseTo: (v: number, decimals?: number) => void;
  toBeGreaterThan: (v: number) => void;
  toBeLessThan: (v: number) => void;
  toContain: (v: unknown) => void;
  toHaveLength: (n: number) => void;
  not: { toContain: (v: unknown) => void };
} {
  const fail = (msg: string): never => { throw new Error(msg); };
  return {
    toBe: (v) => { if (actual !== v) fail(`expected ${String(v)}, got ${String(actual)}`); },
    toBeCloseTo: (v, decimals = 2) => {
      if (typeof actual !== "number" || Math.abs(actual - v) > Math.pow(10, -decimals) / 2) {
        fail(`expected ~${v}, got ${String(actual)}`);
      }
    },
    toBeGreaterThan: (v) => { if (typeof actual !== "number" || !(actual > v)) fail(`expected > ${v}, got ${String(actual)}`); },
    toBeLessThan: (v) => { if (typeof actual !== "number" || !(actual < v)) fail(`expected < ${v}, got ${String(actual)}`); },
    toContain: (v) => { if (!Array.isArray(actual) || !actual.includes(v)) fail(`expected to contain ${String(v)}`); },
    toHaveLength: (n) => { if (!Array.isArray(actual) || actual.length !== n) fail(`expected length ${n}`); },
    not: {
      toContain: (v) => { if (Array.isArray(actual) && actual.includes(v)) fail(`expected NOT to contain ${String(v)}`); },
    },
  };
}

function positionOf(game: HeadlessGame, id: string): [number, number, number] {
  const state = game.core.surface.entities.get(id).state;
  if (!state?.transform) throw new Error(`entity '${id}' has no transform`);
  return state.transform.position;
}

function step(game: HeadlessGame, ticks: number): void {
  for (let i = 0; i < ticks; i++) game.core.kernel.scheduler.stepSingleTick();
}

let shared: HeadlessGame | null = null;
let corrupt: HeadlessGame | null = null;

async function theGame(): Promise<HeadlessGame> {
  if (!shared) shared = await bootHeadlessGame();
  return shared;
}

async function corruptGame(): Promise<HeadlessGame> {
  if (!corrupt) {
    if (shared) disposeHeadlessGame(shared);
    corrupt = await bootHeadlessGame({ fixtureCorruptGate: true });
    shared = null;
  }
  return corrupt;
}

let failures = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`(pass) ${name}`);
  } catch (err) {
    failures++;
    console.error(`(fail) ${name}:`, err instanceof Error ? err.message : String(err));
  }
}

await check("boots every required subsystem through the readiness barrier and never registers network", async () => {
  const game = await theGame();
  const readiness = game.core.readiness();
  expect(readiness.state).toBe("ready");
  for (const id of ["terrain", "physics", "navigation", "spatial"]) {
    expect(readiness.subsystem_states[id]).toBe("ready");
  }
  // Single-player declaration: the network subsystem is intentionally absent.
  expect(Object.keys(readiness.subsystem_states)).not.toContain("network");
  expect(game.core.surface.control.listScenarios()).toContain("boot");
  expect(game.core.surface.control.listScenarios()).toHaveLength(6);
});

await check("keeps the authoritative entity set at authored spawns without any renderer", async () => {
  const game = await theGame();
  game.core.resetScenario("boot");
  const ids = game.core.surface.entities.list();
  for (const id of ["bw-rover", "bw-relay-gate", "bw-power-cell", "bw-field-transceiver", "bw-service-drone", "bw-beacon"]) {
    expect(ids).toContain(id);
  }
  const gate = positionOf(game, "bw-relay-gate");
  expect(gate[0]).toBe(LAYOUT.relay_gate.x);
  const expectedClosedY = game.core.context.sample(LAYOUT.relay_gate.x, LAYOUT.relay_gate.z) + 2.0;
  expect(gate[1]).toBeCloseTo(expectedClosedY, 2);
});

await check("drives the rover along the canonical terrain (active-play)", async () => {
  const game = await theGame();
  game.core.resetScenario("active-play");
  step(game, 160);
  const pos = positionOf(game, "bw-rover");
  const displacement = Math.hypot(pos[0] - LAYOUT.rover_spawn.x, pos[2] - LAYOUT.rover_spawn.z);
  expect(displacement).toBeGreaterThan(2.5);
  const ground = game.core.context.sample(pos[0], pos[2]);
  expect(pos[1]).toBeGreaterThan(ground - 1.5);
  expect(pos[1]).toBeLessThan(ground + 3.5);
});

await check("completes cell delivery and raises the relay gate (transceiver-interaction)", async () => {
  const game = await theGame();
  game.core.resetScenario("transceiver-interaction");
  step(game, 240);

  const gate = positionOf(game, "bw-relay-gate");
  const expectedOpenY = game.core.context.sample(LAYOUT.relay_gate.x, LAYOUT.relay_gate.z) + 6.0;
  expect(gate[1]).toBeCloseTo(expectedOpenY, 1); // raised by exactly 4.0

  const cell = positionOf(game, "bw-power-cell");
  expect(cell[0]).toBe(LAYOUT.cell_delivery.x);
  expect(cell[1]).toBeCloseTo(game.core.context.sample(LAYOUT.cell_delivery.x, LAYOUT.cell_delivery.z) + LAYOUT.cell_delivery.y_offset, 2);
  expect(cell[2]).toBe(LAYOUT.cell_delivery.z);

  const names = game.core.context.events.map((e) => e.name);
  expect(names).toContain("cell.picked");
  expect(names).toContain("cell.delivered");
  expect(names).toContain("gate.raising");
});

await check("reroutes the drone patrol around a blocking obstacle via navmesh + BVH (patrol-obstacle)", async () => {
  const game = await theGame();
  game.core.resetScenario("patrol-obstacle");
  expect(game.core.surface.entities.list()).toContain("bw-patrol-obstacle");
  step(game, 240);

  expect(game.core.context.patrolRerouted).toBe(true);
  const drone = positionOf(game, "bw-service-drone");
  const b = LAYOUT.drone_patrol_b;
  const hoverY = game.core.context.sample(b.x, b.z) + SIMULATION.drone_hover_height;
  expect(Math.hypot(drone[0] - b.x, drone[2] - b.z)).toBeLessThan(2.0);
  expect(Math.abs(drone[1] - hoverY)).toBeLessThan(3.0);
});

await check("mounts the beacon at the relay tower socket (beacon-activation)", async () => {
  const game = await theGame();
  game.core.resetScenario("beacon-activation");
  step(game, 220);
  const beacon = positionOf(game, "bw-beacon");
  expect(beacon[0]).toBe(LAYOUT.beacon_mount.x);
  expect(beacon[1]).toBeCloseTo(game.core.context.sample(LAYOUT.beacon_mount.x, LAYOUT.beacon_mount.z) + LAYOUT.beacon_mount.y_offset, 2);
  expect(beacon[2]).toBe(LAYOUT.beacon_mount.z);
  expect(game.core.context.beaconPhase).toBe("mounted");
});

await check("holds the corrupt-gate fixture closed in Koota while the program believes it open (TEETH-T22-003 seed)", async () => {
  const game = await corruptGame();
  game.core.resetScenario("transceiver-interaction");
  step(game, 240);
  const gate = positionOf(game, "bw-relay-gate");
  const closedY = game.core.context.sample(LAYOUT.relay_gate.x, LAYOUT.relay_gate.z) + 2.0;
  // Semantic transition corrupted: the authoritative gate NEVER opens.
  expect(gate[1]).toBeCloseTo(closedY, 2);
  expect(game.core.context.attach).toBe("delivered");
});

if (shared) disposeHeadlessGame(shared);
if (corrupt) disposeHeadlessGame(corrupt);
if (failures > 0) {
  console.error(`${failures} headless check(s) failed`);
  process.exit(1);
}
console.log("HEADLESS_SCENARIO_CHECKS_OK");
