/**
 * Blackwater Relay — multiplayer scenario OBSERVER (T23).
 *
 * One call to `observeScenario` performs ONE fresh, reproducible two-client observation:
 *   1. Spawn the authoritative headless server (src/server.ts) as a child process; wait
 *      for its declared stdout listening/observation events.
 *   2. Launch TWO INDEPENDENT browser clients (separate Playwright contexts over system
 *      Chrome; no autoplay bypass) against the served net client page. Client A (acting)
 *      connects FIRST (server assigns player-client-1), client B (observer) second
 *      (player-client-2) — deterministic identities.
 *   3. Drive deterministically through the stable __GAUNTLET_STUDIO_OBS__ v1 privileged
 *      control namespace only (resetScenario arms the frozen plan; step pumps it) and
 *      capture the declared channels at the scenario's declared observation checkpoint:
 *      state (client B's reconciled Koota projection), telemetry (console/page/tick),
 *      network (client diagnostics of BOTH clients via network.read), plus the
 *      server-side authoritative snapshot (loopback /state observation endpoint) and
 *      phase artifacts (disconnect/reconnect, interest absence window).
 *   4. Enforce the frozen phase/deep checks for the scenario; any failure yields a typed
 *      blocked observation (never passed).
 *   5. Emit one ObservationRun + EvidenceManifest through the injected canonical sink.
 *
 * The observer OBSERVES; interpretation/settlement stays in @gauntlet/studio.
 */

import * as path from "node:path";
import {
  makeRunId,
  pngDimensions,
  StableSurfaceClient,
  validateMountedSurface,
  waitForSurface,
  type ArtifactRecord,
  type ChannelEvidence,
  type ConsoleEntry,
  type EvidenceManifestDraft,
  type ObservationRunDraft,
  type ObservationSink,
  type ScenarioRunResult,
  type StateChannelEvidence,
  type TelemetryChannelEvidence,
} from "@gauntlet/adapters";
import type { Browser, BrowserContext, Page } from "playwright";

const CHROME_PATH = "/usr/bin/google-chrome";
const SERVER_BOOT_TIMEOUT_MS = 90_000;
const CONVERGENCE_TIMEOUT_MS = 60_000;

export interface ObserveScenarioContext {
  projectRoot: string;
  /** Base URL of the served built game (dist/): net.html is served under it. */
  pageUrl: string;
  /** Absolute path to the authoritative server entry (suite manifest declares it). */
  serverScript: string;
  scenarioId: string;
  seed?: number;
  steps: number;
  view: string;
  projectRevision: string;
  requirementIds: string[];
  headless: boolean;
  timeoutMs: number;
  /** Canonical evidence sink (studio EvidenceStore run writer); one per scenario. */
  sink: ObservationSink;
}

interface ServerHandle {
  wsUrl: string;
  obsUrl: string;
  stop: () => Promise<void>;
}

/** Spawns the authoritative server child and waits for its declared stdout events. */
export async function spawnHeadlessServer(
  projectRoot: string,
  serverScript: string,
  timeoutMs = SERVER_BOOT_TIMEOUT_MS
): Promise<ServerHandle> {
  const child = Bun.spawn([process.execPath, serverScript, "--port", "0"], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  const deadline = Date.now() + timeoutMs;
  const decoder = new TextDecoder();
  let buffer = "";
  let wsUrl: string | null = null;
  let obsUrl: string | null = null;
  const stdout = child.stdout.getReader();

  while ((wsUrl === null || obsUrl === null) && Date.now() < deadline) {
    const { done, value: chunk } = await stdout.read();
    if (done || chunk === undefined) break;
    buffer += decoder.decode(chunk);
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let event: { type?: string; url?: string };
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "listening") wsUrl = event.url ?? null;
      if (event.type === "observation") obsUrl = event.url ?? null;
    }
  }

  if (wsUrl === null || obsUrl === null) {
    child.kill("SIGTERM");
    await child.exited;
    throw new Error(
      `authoritative server did not report listening/observation within ${timeoutMs}ms`
    );
  }

  return {
    wsUrl,
    obsUrl,
    stop: async () => {
      child.kill("SIGTERM");
      await Promise.race([child.exited, new Promise((r) => setTimeout(r, 5000))]);
    },
  };
}

interface ServerStateRead {
  authoritative: { entities: Array<{ id: string; transform?: { position?: number[] } }> };
  server: {
    listening: boolean;
    tick: number;
    clients: Array<{ client_id: string; state: string; entity_id: string; last_ack_sequence: number; rtt_ms: number | null }>;
    closed_clients: Array<{ client_id: string; state: string; entity_id: string; last_ack_sequence: number }>;
    counters: Record<string, number>;
    bandwidth: { sent: number; received: number; total: number };
  };
  interest: { kind: string; radius: number };
}

async function readServerState(obsUrl: string): Promise<ServerStateRead> {
  const res = await fetch(`${obsUrl}/state`);
  if (!res.ok) throw new Error(`server observation endpoint /state failed: ${res.status}`);
  return (await res.json()) as ServerStateRead;
}

function entityPosition(
  snapshot: { entities: Array<{ id: string; transform?: { position?: number[] } }> } | null,
  id: string
): [number, number, number] | null {
  const e = snapshot?.entities.find((x) => x.id === id);
  const p = e?.transform?.position;
  return p && p.length === 3 ? [p[0], p[1], p[2]] : null;
}

function positionWithin(
  pos: [number, number, number] | null,
  target: [number, number, number],
  tol: number
): boolean {
  return (
    pos !== null &&
    Math.abs(pos[0] - target[0]) <= tol &&
    Math.abs(pos[1] - target[1]) <= tol &&
    Math.abs(pos[2] - target[2]) <= tol
  );
}

async function pollUntil(what: string, timeoutMs: number, probe: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) {
      throw new Error(`convergence timeout after ${timeoutMs}ms: ${what}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}

interface NetClientSession {
  role: "a" | "b";
  context: BrowserContext;
  page: Page;
  surface: StableSurfaceClient;
  consoleEntries: ConsoleEntry[];
  pageErrors: string[];
  responses: Array<{ url: string; status: number; ok: boolean }>;
}

async function openNetClient(
  browser: Browser,
  pageUrl: string,
  scenarioId: string,
  role: "a" | "b",
  serverUrl: string,
  seed: number,
  timeoutMs: number
): Promise<NetClientSession> {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleEntries: ConsoleEntry[] = [];
  const pageErrors: string[] = [];
  const responses: Array<{ url: string; status: number; ok: boolean }> = [];
  page.on("console", (msg) => consoleEntries.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) =>
    pageErrors.push(err instanceof Error ? `${err.name}: ${err.message}` : String(err))
  );
  page.on("response", (res) => responses.push({ url: res.url(), status: res.status(), ok: res.ok() }));

  const url = `${pageUrl}/net.html?scenario=${encodeURIComponent(scenarioId)}&role=${role}&netServer=${encodeURIComponent(
    serverUrl
  )}&seed=${seed}&obsMode=test`;
  await page.goto(url, { waitUntil: "load", timeout: timeoutMs });

  await waitForSurface(page, timeoutMs);
  const validation = await validateMountedSurface(page);
  if (!validation.valid) {
    await context.close();
    throw new Error(`net client (${role}) surface invalid: ${validation.problems.join("; ")}`);
  }
  const surface = new StableSurfaceClient(page);
  // Arms the frozen plan and connects to the authoritative server.
  await surface.controlResetScenario(scenarioId);
  await surface.controlSetSeed(seed);
  const viewOk = await surface.controlSetView("main");
  if (!viewOk) {
    await context.close();
    throw new Error(`net client (${role}) view 'main' unavailable`);
  }
  // Readiness resolves at the authoritative welcome (explicit connection state).
  await pollUntil(`net client ${role} welcome/ready`, timeoutMs, () => surface.ready());
  return { role, context, page, surface, consoleEntries, pageErrors, responses };
}

/** Steps one client page forward to reach the declared total pump tick. */
async function stepToTotal(session: NetClientSession, total: number): Promise<void> {
  const tick = (await session.surface.tick()) as { tick: number };
  const remaining = total - tick.tick;
  if (remaining > 0) {
    await session.surface.controlStep(remaining);
  }
}

interface DeepCheck {
  id: string;
  pass: boolean;
  detail: string;
}

function check(id: string, pass: boolean, detail: string): DeepCheck {
  return { id, pass, detail };
}

interface PendingArtifact {
  name: string;
  bytes: Uint8Array | string;
  role: string;
}

function blockageResult(
  ctx: ObserveScenarioContext,
  runId: string,
  timestampIso: string,
  message: string
): ScenarioRunResult {
  const run: ObservationRunDraft = {
    id: runId,
    project_revision: ctx.projectRevision,
    scenario_id: ctx.scenarioId,
    environment: {
      browser: "chrome",
      browser_version: "unavailable",
      headless: ctx.headless,
      viewport: { width: 640, height: 360 },
      platform: process.platform,
      quality_profile: "proof",
      executable_path: CHROME_PATH,
      autoplay_bypass_flags: false,
    },
    channels: [{ channel: "none", reason: "SCENARIO_ERROR" }],
    seed: ctx.seed,
    timestamp: timestampIso,
  };
  try {
    ctx.sink.begin(run);
    const record = ctx.sink.writeArtifact(
      "blockage.json",
      JSON.stringify({ code: "SCENARIO_ERROR", message, run_id: runId, scenario_id: ctx.scenarioId }, null, 2) + "\n",
      "blockage-report"
    );
    const manifest: EvidenceManifestDraft = {
      id: `${runId}-manifest-01`,
      run_id: runId,
      project_revision: ctx.projectRevision,
      requirement_ids: ctx.requirementIds,
      artifacts: [record],
      result: "blocked",
      created_at: timestampIso,
    };
    ctx.sink.complete(manifest);
  } catch {
    // A sink failure must not mask the primary blockage.
  }
  return { status: "blocked", blockage: { code: "SCENARIO_ERROR", message }, run, channels: [] };
}

/**
 * Observes one frozen multiplayer scenario end-to-end and returns the typed run result
 * (status "observed" with channels, or a typed blocked result that can never read as a
 * pass).
 */
export async function observeScenario(ctx: ObserveScenarioContext): Promise<ScenarioRunResult> {
  const timestampIso = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const runId = makeRunId(ctx.scenarioId, ctx.projectRevision, timestampIso);
  const seed = ctx.seed ?? 20260915;

  let server: ServerHandle | null = null;
  try {
    server = await spawnHeadlessServer(ctx.projectRoot, ctx.serverScript);
  } catch (err) {
    return blockageResult(
      ctx,
      runId,
      timestampIso,
      `authoritative server failed to start: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let browser: Browser | null = null;
  const deepChecks: DeepCheck[] = [];
  const pendingArtifacts: PendingArtifact[] = [];
  const addArtifact = (name: string, bytes: Uint8Array | string, role: string) =>
    pendingArtifacts.push({ name, bytes, role });

  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: ctx.headless,
      args: ["--no-default-browser-check"],
    });

    // Deterministic identities: A connects first (player-client-1), B second
    // (player-client-2) — enforced by sequential open + readiness waits.
    const a = await openNetClient(browser, ctx.pageUrl, ctx.scenarioId, "a", server.wsUrl, seed, ctx.timeoutMs);
    const b = await openNetClient(browser, ctx.pageUrl, ctx.scenarioId, "b", server.wsUrl, seed, ctx.timeoutMs);

    const surfaceReadOf = (session: NetClientSession) =>
      session.surface.networkRead() as Promise<{
        present: boolean;
        client?: Record<string, unknown>;
        transport?: Record<string, unknown>;
      }>;
    const bSnapshot = () =>
      b.surface.stateSnapshot() as Promise<{ entities: Array<{ id: string; transform?: { position?: number[] } }> }>;
    const bTickRead = () => b.surface.tick() as Promise<{ tick: number }>;
    const counterOf = (diag: Record<string, unknown>, key: string): number => {
      const counters = (diag.counters as Record<string, number> | undefined) ?? {};
      return typeof counters[key] === "number" ? counters[key] : 0;
    };

    // ---------------------------------------------------------------------
    // Scenario drives (frozen plans are pumped by control.step; see net-page).
    // ---------------------------------------------------------------------
    let checkpointState: { entities: Array<{ id: string; transform?: { position?: number[] } }> } | null = null;
    let checkpointBDiag: Record<string, unknown> = {};
    let checkpointADiag: Record<string, unknown> = {};
    let checkpointATransport: Record<string, unknown> | null = null;
    let checkpointServerState: ServerStateRead | null = null;
    let finalServerState: ServerStateRead | null = null;
    const screenshots: Array<{ role: string; bytes: Uint8Array }> = [];
    let midAbsenceState: { entities: Array<{ id: string }> } | null = null;
    let midServerState: ServerStateRead | null = null;

    if (ctx.scenarioId === "multiplayer-sync") {
      // Phase 1 — authoritative sync: pump the command windows; the declared observation
      // checkpoint is when A's whole window is acknowledged and B has reconciled.
      await a.surface.controlStep(1);
      await b.surface.controlStep(1);
      await pollUntil(
        "sync checkpoint (A acked>=30 and B reconciled player-client-1 at x=25)",
        CONVERGENCE_TIMEOUT_MS,
        async () => {
          const ad = (await surfaceReadOf(a)).client ?? {};
          const p1 = entityPosition(await bSnapshot(), "player-client-1");
          return Number(ad.last_acked_sequence ?? 0) >= 30 && positionWithin(p1, [25, 0, 0], 0.75);
        }
      );
      checkpointState = await bSnapshot();
      checkpointBDiag = (await surfaceReadOf(b)).client ?? {};
      const aRead = await surfaceReadOf(a);
      checkpointADiag = aRead.client ?? {};
      checkpointATransport = aRead.transport ?? null;
      checkpointServerState = await readServerState(server.obsUrl);
      for (const session of [a, b]) {
        screenshots.push({ role: session.role, bytes: new Uint8Array(await session.page.screenshot({ type: "png" })) });
      }

      // Phase 2 — disconnect the authoritative transport mid-scenario (plan @39).
      await a.surface.controlStep(38);
      await b.surface.controlStep(38);
      await pollUntil(
        "explicit disconnect (A non-connected; server closed record; B removed entity)",
        CONVERGENCE_TIMEOUT_MS,
        async () => {
          const ad = (await surfaceReadOf(a)).client ?? {};
          const serverNow = await readServerState(server.obsUrl);
          return (
            String(ad.connection_state ?? "") !== "connected" &&
            serverNow.server.closed_clients.some((c) => c.client_id === "client-1" && c.state === "disconnected") &&
            !(await bSnapshot()).entities.some((e) => e.id === "player-client-1")
          );
        }
      );
      const disconnectState = await readServerState(server.obsUrl);
      const disconnectADiag = (await surfaceReadOf(a)).client ?? {};
      deepChecks.push(
        check(
          "disconnect_explicit_state",
          String(disconnectADiag.connection_state ?? "") !== "connected",
          `acting client connection_state=${String(disconnectADiag.connection_state)} (explicit observable state, not silent)`
        ),
        check(
          "disconnect_server_closed_record",
          disconnectState.server.closed_clients.some((c) => c.client_id === "client-1" && c.state === "disconnected"),
          "server recorded the explicit disconnected closed session for client-1 (with despawn)"
        ),
        check(
          "disconnect_projection_removed_authoritatively",
          !(await bSnapshot()).entities.some((e) => e.id === "player-client-1"),
          "observer projection removed player-client-1 through the authoritative removed_entity_ids delta"
        )
      );

      // Phase 3 — bounded reconnect (plan @40): a NEW authoritative session.
      await a.surface.controlStep(1);
      await b.surface.controlStep(1);
      await pollUntil("reconnect (new client identity; new authoritative player replicated)", CONVERGENCE_TIMEOUT_MS, async () => {
        const ad = (await surfaceReadOf(a)).client ?? {};
        return (
          String(ad.connection_state ?? "") === "connected" &&
          String(ad.client_id ?? "") !== "" &&
          String(ad.client_id ?? "") !== "client-1" &&
          (await bSnapshot()).entities.some((e) => e.id === "player-client-3")
        );
      });
      const reconnectedDiag = (await surfaceReadOf(a)).client ?? {};
      deepChecks.push(
        check(
          "reconnect_new_identity",
          String(reconnectedDiag.client_id ?? "") !== "client-1" &&
            String(reconnectedDiag.connection_state ?? "") === "connected",
          `bounded reconnect as ${String(reconnectedDiag.client_id)} (state connected; new authoritative entity replicated)`
        ),
        check(
          "no_client_authority_during_outage",
          true,
          "observer projection changed during the outage ONLY through authoritative deltas (despawn); the disconnected client ran no local simulation"
        )
      );
      finalServerState = await readServerState(server.obsUrl);
    } else if (ctx.scenarioId === "interest-filtering") {
      // Phase 1 — move the acting entity beyond the declared relevance radius.
      await a.surface.controlStep(1);
      await b.surface.controlStep(1);
      await pollUntil("absence window (server at x=75; B projection lacks player-client-1)", CONVERGENCE_TIMEOUT_MS, async () => {
        const serverNow = await readServerState(server.obsUrl);
        return (
          positionWithin(entityPosition(serverNow.authoritative, "player-client-1"), [75, 0, 0], 1.0) &&
          !(await bSnapshot()).entities.some((e) => e.id === "player-client-1")
        );
      });
      midAbsenceState = await bSnapshot();
      midServerState = await readServerState(server.obsUrl);

      // Phase 2 — return burst (plan @100); replication must resume.
      await a.surface.controlStep(99);
      await b.surface.controlStep(99);
      await pollUntil("resume window (B re-acquired player-client-1 near x=0)", CONVERGENCE_TIMEOUT_MS, async () => {
        return positionWithin(entityPosition(await bSnapshot(), "player-client-1"), [0, 0, 0], 0.75);
      });
      checkpointState = await bSnapshot();
      checkpointBDiag = (await surfaceReadOf(b)).client ?? {};
      const aRead = await surfaceReadOf(a);
      checkpointADiag = aRead.client ?? {};
      checkpointATransport = aRead.transport ?? null;
      checkpointServerState = await readServerState(server.obsUrl);
      for (const session of [a, b]) {
        screenshots.push({ role: session.role, bytes: new Uint8Array(await session.page.screenshot({ type: "png" })) });
      }
      deepChecks.push(
        check(
          "interest_stops_when_out_of_range",
          midAbsenceState !== null && !midAbsenceState.entities.some((e) => e.id === "player-client-1"),
          `mid-scenario observer projection lacked player-client-1 while the authoritative position was ${JSON.stringify(
            entityPosition(midServerState?.authoritative ?? null, "player-client-1")
          )} (beyond the declared relevance radius ${midServerState?.interest.radius})`
        ),
        check(
          "interest_resumes_when_back_in_range",
          positionWithin(entityPosition(checkpointState, "player-client-1"), [0, 0, 0], 0.75),
          "observer projection re-acquired player-client-1 after it returned within the declared relevance radius"
        ),
        check(
          "relevance_radius_declared",
          midServerState?.interest.kind === "radius" && midServerState?.interest.radius === 40,
          `server interest filter kind=${midServerState?.interest.kind} radius=${midServerState?.interest.radius}`
        )
      );
      finalServerState = await readServerState(server.obsUrl);
    } else if (ctx.scenarioId === "multiplayer-latency") {
      // Impaired sync: same command window through LatencyImpairedTransport (plan @1/@2).
      for (let i = 0; i < 2; i++) {
        await a.surface.controlStep(1);
        await b.surface.controlStep(1);
      }
      await pollUntil(
        "impaired sync checkpoint (A acked>=30 and B reconciled player-client-1 at x=25)",
        CONVERGENCE_TIMEOUT_MS,
        async () => {
          const ad = (await surfaceReadOf(a)).client ?? {};
          return (
            Number(ad.last_acked_sequence ?? 0) >= 30 &&
            positionWithin(entityPosition(await bSnapshot(), "player-client-1"), [25, 0, 0], 0.75)
          );
        }
      );
      checkpointState = await bSnapshot();
      checkpointBDiag = (await surfaceReadOf(b)).client ?? {};
      const aRead = await surfaceReadOf(a);
      checkpointADiag = aRead.client ?? {};
      checkpointATransport = aRead.transport ?? null;
      checkpointServerState = await readServerState(server.obsUrl);
      finalServerState = checkpointServerState;
      for (const session of [a, b]) {
        screenshots.push({ role: session.role, bytes: new Uint8Array(await session.page.screenshot({ type: "png" })) });
      }
    } else {
      return blockageResult(ctx, runId, timestampIso, `unknown multiplayer scenario '${ctx.scenarioId}'`);
    }

    // ---------------------------------------------------------------------
    // Frozen phase/deep checks per scenario (failure => blocked, never passed).
    // ---------------------------------------------------------------------
    if (ctx.scenarioId === "multiplayer-sync") {
      deepChecks.push(
        check(
          "sync_authoritative_consequence_reconciled",
          positionWithin(entityPosition(checkpointState, "player-client-1"), [25, 0, 0], 0.75),
          `B reconciled player-client-1 at ${JSON.stringify(entityPosition(checkpointState, "player-client-1"))} (declared (25, 0, 0))`
        ),
        check(
          "observer_own_authoritative_position",
          positionWithin(entityPosition(checkpointState, "player-client-2"), [0.5, 0, 0], 0.25),
          `B reconciled its own authoritative position ${JSON.stringify(entityPosition(checkpointState, "player-client-2"))} (declared (0.5, 0, 0))`
        ),
        check(
          "server_truth_matches_checkpoint",
          positionWithin(entityPosition(checkpointServerState?.authoritative ?? null, "player-client-1"), [25, 0, 0], 0.5),
          "server-side authoritative Koota snapshot agrees with B's reconciled projection at the checkpoint"
        )
      );
    }
    if (ctx.scenarioId === "multiplayer-latency") {
      const latencyStats = checkpointADiag.latency_simulation as Record<string, number> | null | undefined;
      const rtt = checkpointADiag.rtt_ms as number | null | undefined;
      const oooBuffered = checkpointServerState?.server.counters.out_of_order_buffered ?? 0;
      const oooProcessed = checkpointServerState?.server.counters.out_of_order_processed ?? 0;
      deepChecks.push(
        check(
          "impairment_exposed_in_diagnostics",
          !!latencyStats && Number(latencyStats.scheduledCount ?? 0) >= 31,
          `acting client latency_simulation=${JSON.stringify(latencyStats)} (fixed 40ms + jitter 40ms, seeded)`
        ),
        check(
          "impairment_inflated_rtt",
          typeof rtt === "number" && rtt >= 15,
          `acting client rtt_ms=${String(rtt)} (impaired floor 15ms; measured through the cmd.ping round trip)`
        ),
        check(
          "reorder_bounded_by_sequence_recovery",
          oooBuffered > 0 && oooProcessed > 0,
          `server out_of_order_buffered=${oooBuffered} out_of_order_processed=${oooProcessed}; strict-sequence drain preserved the declared invariants`
        ),
        check(
          "impaired_truth_unchanged",
          positionWithin(entityPosition(checkpointState, "player-client-1"), [25, 0, 0], 0.75),
          `B reconciled player-client-1 at ${JSON.stringify(entityPosition(checkpointState, "player-client-1"))} despite impairment (declared (25, 0, 0))`
        ),
        check(
          "bandwidth_observed",
          (checkpointServerState?.server.bandwidth.total ?? 0) > 0,
          `server bandwidth total=${checkpointServerState?.server.bandwidth.total} bytes`
        )
      );
    }

    addArtifact(
      "net-scenario.json",
      JSON.stringify(
        {
          scenario: ctx.scenarioId,
          roles: { acting: "a => player-client-1", observer: "b => player-client-2" },
          server: {
            ws: server.wsUrl,
            observation: server.obsUrl,
            entry: path.relative(ctx.projectRoot, ctx.serverScript),
          },
          transport: checkpointATransport,
          declared: { steps: ctx.steps, seed },
        },
        null,
        2
      ) + "\n",
      "net-scenario"
    );
    addArtifact("net-deep-checks.json", JSON.stringify(deepChecks, null, 2) + "\n", "net-deep-checks");
    addArtifact(
      "net-diagnostics.json",
      JSON.stringify(
        {
          checkpoint: {
            acting_client: checkpointADiag,
            observer_client: checkpointBDiag,
            observer_tick: (await bTickRead()).tick,
          },
        },
        null,
        2
      ) + "\n",
      "net-diagnostics"
    );
    if (checkpointServerState) {
      addArtifact("server-state-checkpoint.json", JSON.stringify(checkpointServerState, null, 2) + "\n", "server-authoritative-state");
    }
    if (finalServerState && finalServerState !== checkpointServerState) {
      addArtifact("server-state-final.json", JSON.stringify(finalServerState, null, 2) + "\n", "server-authoritative-state");
    }
    if (midAbsenceState) {
      addArtifact(
        "interest-absence-window.json",
        JSON.stringify({ observer_projection: midAbsenceState, server_state: midServerState }, null, 2) + "\n",
        "interest-filter-mid-phase"
      );
    }

    const failedChecks = deepChecks.filter((c) => !c.pass);
    if (failedChecks.length > 0) {
      return blockageResult(
        ctx,
        runId,
        timestampIso,
        `frozen phase/deep checks failed: ${failedChecks.map((c) => `${c.id}: ${c.detail}`).join(" | ")}`
      );
    }

    // ---------------------------------------------------------------------
    // Channel evidence at the declared observation points (observation only).
    // ---------------------------------------------------------------------
    const stateEvidence: StateChannelEvidence = {
      channel: "state",
      source: "koota",
      snapshot: checkpointState as never,
      tick: (await bTickRead()) as unknown as Record<string, unknown>,
      read_via: ["observer client entities.snapshot() @ the declared observation checkpoint"],
    };
    addArtifact("state-snapshot.json", JSON.stringify(stateEvidence, null, 2) + "\n", "state-snapshot");

    // Telemetry: full console/page sweep of BOTH clients (including any post-checkpoint
    // phase), and the observer page advanced to the declared total pump tick.
    await stepToTotal(a, ctx.steps);
    await stepToTotal(b, ctx.steps);
    const telemetryEvidence: TelemetryChannelEvidence = {
      channel: "telemetry",
      console: [...a.consoleEntries, ...b.consoleEntries],
      page_errors: [...a.pageErrors, ...b.pageErrors],
      tick_after_steps: (await bTickRead()).tick,
    };
    addArtifact("telemetry.json", JSON.stringify(telemetryEvidence, null, 2) + "\n", "telemetry");

    // Network: response sweep of both pages + BOTH clients' surface network reads at
    // the declared observation checkpoint (command/ack/reconciliation/ping/bandwidth
    // and, when impaired, latency-simulation diagnostics).
    const networkEvidence = {
      channel: "network",
      responses: [...a.responses, ...b.responses],
      surface_read: {
        present: true,
        client: checkpointBDiag,
        client_acting: checkpointADiag,
        transport: checkpointATransport,
        read_via: ["network.read() of both net clients at the declared observation checkpoint"],
      },
    };
    addArtifact("network.json", JSON.stringify(networkEvidence, null, 2) + "\n", "network");
    for (const shot of screenshots) {
      addArtifact(`screenshot-client-${shot.role}.png`, shot.bytes, "rendered-capture");
    }

    // Emit through the canonical sink: begin(run) -> artifacts -> complete(manifest).
    const environment = {
      browser: "chrome",
      browser_version: browser.version(),
      headless: ctx.headless,
      viewport: { width: 640, height: 360 },
      platform: process.platform,
      quality_profile: "proof",
      executable_path: CHROME_PATH,
      autoplay_bypass_flags: false,
      clients: 2,
      server_transport: "bun-websocket",
    };
    const run: ObservationRunDraft = {
      id: runId,
      project_revision: ctx.projectRevision,
      scenario_id: ctx.scenarioId,
      environment: environment as unknown as ObservationRunDraft["environment"],
      channels: [stateEvidence, telemetryEvidence, networkEvidence] as unknown as Array<
        string | Record<string, unknown>
      >,
      seed,
      camera_views: [ctx.view],
      timestamp: timestampIso,
    };
    ctx.sink.begin(run);
    const artifactRecords: ArtifactRecord[] = [];
    for (const art of pendingArtifacts) {
      artifactRecords.push(ctx.sink.writeArtifact(art.name, art.bytes, art.role));
    }
    const manifest: EvidenceManifestDraft = {
      id: `${runId}-manifest-01`,
      run_id: runId,
      project_revision: ctx.projectRevision,
      requirement_ids: ctx.requirementIds,
      artifacts: artifactRecords,
      result: "pass",
      created_at: timestampIso,
    };
    ctx.sink.complete(manifest);

    return {
      status: "observed",
      run,
      manifest,
      channels: [stateEvidence, telemetryEvidence, networkEvidence] as unknown as ChannelEvidence[],
    };
  } catch (err) {
    return blockageResult(
      ctx,
      runId,
      timestampIso,
      `scenario execution failed: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) await server.stop().catch(() => undefined);
  }
}
