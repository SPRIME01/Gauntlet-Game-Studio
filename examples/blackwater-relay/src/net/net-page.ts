/**
 * Blackwater Relay — networked browser client page (T23).
 *
 * A server-authoritative CLIENT: its Koota world is a PROJECTION world reconciled one-way
 * from authoritative snapshots through the runtime NetworkClient (REQ-SAFE-006); it never
 * runs the game simulation and never authors authoritative state. All state-changing
 * actions are validated sequenced commands (cmd.move / cmd.ping; REQ-NET-003).
 *
 * The page mounts the stable __GAUNTLET_STUDIO_OBS__ v1 surface for observation/evidence
 * (state = reconciled projection snapshot, network.read = client diagnostics) and is
 * driven deterministically through the privileged control namespace ONLY (control.
 * resetScenario arms the frozen per-scenario command plan; control.step pumps it) — the
 * same observation/drive discipline as the single-player build. No other control seam
 * exists.
 *
 * This module is imported ONLY by the net client entry (src/net/main.ts, bundled to
 * dist/net-client.js). The single-player build never imports it.
 */

import {
  BunWebSocketClientTransport,
  createObservabilityBridge,
  GauntletKernel,
  LatencyImpairedTransport,
  NetworkClient,
  type ConnectionTransport,
  type ObservabilityBridge,
} from "@gauntlet/runtime";
import { MULTIPLAYER } from "../game/config";

export const NET_SCENARIO_IDS = [
  "multiplayer-sync",
  "interest-filtering",
  "multiplayer-latency",
] as const;

export type NetScenarioId = (typeof NET_SCENARIO_IDS)[number];

/** Frozen per-scenario command plans (game.spec.yaml `scenarios`, multiplayer block). */
type PlanAction =
  | { type: "moves"; count: number; direction: [number, number, number]; speed: number }
  | { type: "ping" }
  | { type: "disconnect" }
  | { type: "reconnect" };

const MOVES = (
  count: number,
  direction: [number, number, number],
  speed: number
): PlanAction => ({ type: "moves", count, direction, speed });
const PING: PlanAction = { type: "ping" };
const DISCONNECT: PlanAction = { type: "disconnect" };
const RECONNECT: PlanAction = { type: "reconnect" };

/**
 * Plans are keyed by control.step pump tick. Displacement is exact: each applied
 * cmd.move displaces speed * (1/60) along the unit direction (T12 applyCommand), and
 * the server drains contiguous commands in strict sequence order.
 *  - multiplayer-sync A: 30 moves * 50/60 = +25.0 (checkpoint), disconnect @39, reconnect @40.
 *  - observer B: 5 moves * 6/60 = +0.5.
 *  - interest-filtering A: 90 moves out (+75.0, beyond the 40-unit relevance radius),
 *    return burst of 90 moves at pump tick 100 (back to 0.0).
 *  - multiplayer-latency A: identical command window to sync, impaired transport.
 */
export const NET_PLANS: Record<NetScenarioId, Record<"a" | "b", Record<number, PlanAction[]>>> = {
  "multiplayer-sync": {
    a: { 1: [MOVES(30, [1, 0, 0], MULTIPLAYER.acting_move_speed), PING], 39: [DISCONNECT], 40: [RECONNECT] },
    b: { 1: [MOVES(5, [1, 0, 0], MULTIPLAYER.observer_move_speed), PING] },
  },
  "interest-filtering": {
    a: {
      1: [MOVES(90, [1, 0, 0], MULTIPLAYER.acting_move_speed)],
      100: [MOVES(90, [-1, 0, 0], MULTIPLAYER.acting_move_speed)],
    },
    b: { 1: [PING] },
  },
  "multiplayer-latency": {
    a: { 1: [MOVES(30, [1, 0, 0], MULTIPLAYER.acting_move_speed), PING], 2: [PING] },
    b: { 1: [MOVES(5, [1, 0, 0], MULTIPLAYER.observer_move_speed), PING] },
  },
};

/** Deterministic seeded RNG (mulberry32) for reproducible jitter/reorder patterns. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NetPageConfig {
  scenario: NetScenarioId;
  role: "a" | "b";
  serverUrl: string;
  seed: number;
  mode: "development" | "test" | "production";
}

export function readNetPageConfig(): NetPageConfig {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get("scenario") as NetScenarioId | null;
  const role = params.get("role");
  const serverUrl = params.get("netServer");
  if (!scenario || !NET_SCENARIO_IDS.includes(scenario)) {
    throw new Error(`net client requires ?scenario= one of ${NET_SCENARIO_IDS.join(", ")}`);
  }
  if (role !== "a" && role !== "b") {
    throw new Error("net client requires ?role=a|b");
  }
  if (!serverUrl) {
    throw new Error("net client requires ?netServer=ws://host:port");
  }
  const requested = params.get("obsMode");
  return {
    scenario,
    role,
    serverUrl,
    seed: Number.isFinite(Number(params.get("seed"))) ? Number(params.get("seed")) : 20260915,
    mode:
      requested === "production" || requested === "test" || requested === "development"
        ? requested
        : "test",
  };
}

interface SessionRecord {
  index: number;
  client_id: string | null;
  entity_id: string | null;
  closed_at_step: number | null;
}

/**
 * Owns the active NetworkClient session(s) and the frozen command plan. All evidence
 * reads travel through the mounted stable surface (network.read / entities.snapshot);
 * this controller holds no evidence channel of its own.
 */
class NetClientController {
  private client: NetworkClient | null = null;
  private transport: ConnectionTransport | null = null;
  private step = 0;
  private sessionIndex = 0;
  private readonly sessions: SessionRecord[] = [];
  private bootedScenario: NetScenarioId | null = null;
  private networkBarrierResolved = false;

  constructor(
    private readonly kernel: GauntletKernel,
    private readonly bridge: ObservabilityBridge,
    private readonly config: NetPageConfig
  ) {
    kernel.scheduler.registerStepHandler(() => this.pump());
  }

  /** Arms and connects the frozen plan for one scenario run (control.resetScenario). */
  public begin(scenario: NetScenarioId): void {
    this.bootedScenario = scenario;
    this.step = 0;
    // Reset the projection world: reconciliation re-creates everything authoritative.
    for (const id of this.kernel.gameWorld.getEntityIds()) {
      this.kernel.gameWorld.despawnEntity(id);
    }
    if (!this.client && !this.connecting) {
      this.armNetworkBarrier();
      void this.openSession();
    }
  }

  private connecting = false;

  /**
   * Registers the client's single required subsystem ("network") once. Readiness
   * resolves at the first authoritative welcome and is never revoked: later sessions
   * (reconnect) are explicit client-identity transitions on the same surface.
   */
  private armNetworkBarrier(): void {
    if (this.networkBarrierResolved) return;
    this.kernel.barrier.register("network", true);
    this.kernel.barrier.markBooting("network");
  }

  private async openSession(): Promise<void> {
    this.connecting = true;
    this.sessionIndex += 1;
    let transport: ConnectionTransport = new BunWebSocketClientTransport(this.config.serverUrl);
    // Impairment is a declared scenario condition on the ACTING client only
    // (multiplayer-latency; game.spec.yaml multiplayer.latency_impairment).
    if (this.config.role === "a" && this.config.scenario === "multiplayer-latency") {
      transport = new LatencyImpairedTransport(transport, {
        fixedLatencyMs: MULTIPLAYER.latency_fixed_ms,
        jitterMs: MULTIPLAYER.latency_jitter_ms,
        packetLossRatio: MULTIPLAYER.latency_loss,
        randomFn: seededRandom(this.config.seed + this.sessionIndex),
      });
    }
    const client = new NetworkClient({ transport, projectionWorld: this.kernel.gameWorld });
    this.client = client;
    this.transport = transport;
    this.bridge.attachNetwork({ client, characteristics: transport.characteristics });
    try {
      await client.connect();
    } finally {
      this.connecting = false;
    }

    // Resolve readiness at the authoritative welcome (explicit connection state).
    const deadline = Date.now() + 10000;
    while (client.getClientId() === null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    if (client.getClientId() !== null) {
      this.sessions.push({
        index: this.sessionIndex,
        client_id: client.getClientId(),
        entity_id: client.getEntityId(),
        closed_at_step: null,
      });
      if (!this.networkBarrierResolved) {
        this.networkBarrierResolved = true;
        this.kernel.barrier.markReady("network");
      }
    }
  }

  /** One authoritative pump tick (control.step); executes the frozen plan slice. */
  private pump(): void {
    this.step += 1;
    if (!this.bootedScenario) return;
    const actions = NET_PLANS[this.bootedScenario][this.config.role][this.step];
    if (!actions) return;
    for (const action of actions) {
      this.execute(action);
    }
  }

  private execute(action: PlanAction): void {
    const status = document.getElementById("net-status");
    const note = (text: string) => {
      if (status) status.textContent = text;
    };
    switch (action.type) {
      case "moves": {
        const client = this.client;
        const entityId = client?.getEntityId();
        if (!client || !entityId) return;
        for (let i = 0; i < action.count; i++) {
          client.sendCommand("cmd.move", {
            entity_id: entityId,
            direction: [...action.direction] as [number, number, number],
            speed: action.speed,
          });
        }
        note(`${this.config.scenario} role=${this.config.role}: ${action.count} moves @step ${this.step}`);
        break;
      }
      case "ping": {
        this.client?.sendCommand("cmd.ping", { client_time_ms: performance.now() });
        break;
      }
      case "disconnect": {
        const client = this.client;
        if (!client) return;
        const record = this.sessions[this.sessions.length - 1];
        if (record) record.closed_at_step = this.step;
        // Explicit transport close (mid-scenario). The client KEEPS its projection and
        // its diagnostics: no local simulation starts, so it never becomes semantic
        // authority (REQ-NET-009, REQ-SAFE-006). network.read() keeps reporting the
        // explicit non-connected connection state.
        client.close();
        this.client = null;
        this.transport = null;
        note(`${this.config.scenario} role=${this.config.role}: disconnected @step ${this.step}`);
        break;
      }
      case "reconnect": {
        // Bounded reconnect: one fresh authoritative session (new client identity).
        this.armNetworkBarrier();
        void this.openSession();
        note(`${this.config.scenario} role=${this.config.role}: reconnecting @step ${this.step}`);
        break;
      }
    }
  }

  public get currentStep(): number {
    return this.step;
  }

  public get sessionLog(): readonly SessionRecord[] {
    return this.sessions;
  }
}

export interface NetPageBoot {
  kernel: GauntletKernel;
  bridge: ObservabilityBridge;
  controller: NetClientController;
  config: NetPageConfig;
}

export async function bootNetClientPage(): Promise<NetPageBoot> {
  const config = readNetPageConfig();
  const status = document.getElementById("net-status");
  if (status) status.textContent = `net boot ${config.scenario} role=${config.role}…`;

  const kernel = new GauntletKernel({ mode: "headless" });
  const bridge = createObservabilityBridge({ mode: config.mode, kernel, maxStepTicks: 240 });
  bridge.registerView("main", () => ({
    name: "main",
    position: [0, 24, 40],
    target: [0, 0, 0],
    fov: 60,
  }));
  const controller = new NetClientController(kernel, bridge, config);
  for (const scenario of NET_SCENARIO_IDS) {
    bridge.registerScenario(scenario, () => controller.begin(scenario), {
      default: scenario === config.scenario,
    });
  }
  if (status) status.textContent = `net armed ${config.scenario} role=${config.role}`;
  return { kernel, bridge, controller, config };
}
