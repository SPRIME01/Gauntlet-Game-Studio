/**
 * Playwright deterministic proof harness (T20, REQ-BIND-010, REQ-GOAL-004, REQ-OUT-003).
 *
 * One call to `runScenario` performs ONE fresh, reproducible observation:
 *   1. Load Playwright (injectable loader; typed blocked result when unavailable —
 *      RECOV-004/TEETH-T20-003: required browser proof that cannot run is blocked,
 *      never passed).
 *   2. Preflight the system Chrome executable (default /usr/bin/google-chrome). No
 *      browser downloads; no autoplay-policy bypass flags of any kind.
 *   3. Serve inline scenario HTML over loopback (or navigate a provided URL).
 *   4. Wait for the stable `__GAUNTLET_STUDIO_OBS__` v1 surface, validate it
 *      structurally (missing stable methods fail here — never DOM fallbacks).
 *   5. Drive determinism through the privileged control namespace only:
 *      resetScenario -> setSeed -> setView -> bounded step -> pause -> settle frames.
 *   6. Capture channels: semantic state (Koota-backed snapshot), pixels (screenshot
 *      per named view), telemetry (console/page errors + tick), network (responses +
 *      surface read), renderer identity (REQ-BIND-010).
 *   7. Emit an ObservationRun + EvidenceManifest through an injectable sink. The
 *      canonical sink (studio evidence store) enforces schema, immutability, and the
 *      artifacts/runs/<run-id>/ layout; the default sink writes a plain run dir.
 *
 * The harness OBSERVES; it never interprets expectations or settles requirements.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_CHROME_PATH,
  type ArtifactRecord,
  type ChannelEvidence,
  type ConsoleEntry,
  type EvidenceManifestDraft,
  type NetworkChannelEvidence,
  type ObservationRunDraft,
  type ObservationSink,
  type PixelCapture,
  type PixelsChannelEvidence,
  type PlaywrightLoader,
  type ScenarioDefinition,
  type ScenarioRunResult,
  type StateChannelEvidence,
  type TelemetryChannelEvidence,
} from "./types";
import type { SemanticStateSnapshot } from "@gauntlet/runtime";
import {
  StableSurfaceClient,
  validateMountedSurface,
  waitForSurface,
} from "./surface-client";
import { capturePerformanceEvidence } from "./perf";

export const DEFAULT_STEPS = 3;

function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Minimal PNG IHDR dimension parser (no dependencies). */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return null;
  const u32 = (o: number) =>
    ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

function assertScenarioId(id: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new Error(`scenario id '${id}' violates normalized identifier rules`);
  }
}

function shortRevision(revision: string): string {
  return revision.replace(/[^a-z0-9._-]/gi, "").slice(0, 12) || "unknown";
}

export function makeRunId(scenarioId: string, revision: string, timestampIso: string): string {
  const stamp = timestampIso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `run-${scenarioId}-${shortRevision(revision)}-${stamp}`;
}

/** Mime types for known artifact roles. */
function mimeFor(name: string): string {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

/**
 * Default sink: writes run.json / manifest.json / artifacts/* under `outDir/<run-id>/`.
 * Immutability: an existing run directory is never overwritten. The canonical
 * schema-enforced sink lives in @gauntlet/studio (EvidenceStore).
 */
export class DirectoryRunSink implements ObservationSink {
  private dir: string | null = null;
  private artifactIndex = 0;

  constructor(private readonly outDir: string) {}

  begin(run: ObservationRunDraft): void {
    this.dir = join(this.outDir, run.id);
    if (existsSync(this.dir)) {
      throw new Error(
        `run directory '${this.dir}' already exists; evidence is immutable and append-only (never overwrite)`
      );
    }
    mkdirSync(join(this.dir, "artifacts"), { recursive: true });
    writeFileSync(join(this.dir, "run.json"), JSON.stringify(run, null, 2) + "\n", "utf-8");
  }

  writeArtifact(name: string, bytes: Uint8Array | string, role: string): ArtifactRecord {
    if (!this.dir) throw new Error("sink.begin must be called before writeArtifact");
    this.artifactIndex += 1;
    const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    writeFileSync(join(this.dir, "artifacts", name), data);
    return {
      id: `artifact-${String(this.artifactIndex).padStart(2, "0")}`,
      path: `artifacts/${name}`,
      sha256: sha256Hex(data),
      role,
      size_bytes: data.byteLength,
      mime_type: mimeFor(name),
    };
  }

  complete(manifest: EvidenceManifestDraft): void {
    if (!this.dir) throw new Error("sink.begin must be called before complete");
    writeFileSync(join(this.dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  }

  get runDir(): string | null {
    return this.dir;
  }
}

export interface RunScenarioOptions {
  scenario: ScenarioDefinition;
  /** Immutable project revision this observation belongs to (REQUIRED, REQ-OUT-003). */
  projectRevision: string;
  /** Requirement IDs the resulting evidence is intended to support. */
  requirementIds: string[];
  /** Canonical sink override (studio EvidenceStore). Default: DirectoryRunSink. */
  sink?: ObservationSink;
  /** Output root for the default sink. */
  outDir?: string;
  /** Injectable Playwright loader (TEETH-T20-003 simulation seam). */
  playwrightLoader?: PlaywrightLoader;
  /** System Chrome executable path. Default /usr/bin/google-chrome. */
  chromeExecutablePath?: string;
  /** Headless proof by default (deterministic CI); headed requires a display. */
  headless?: boolean;
  timeoutMs?: number;
  /** Playwright trace capture into the run directory. Default false. */
  captureTrace?: boolean;
  /**
   * Named quality profile the observation is taken under (T21). MUST be declared by
   * the game project before use as a gate; recorded in run.environment.quality_profile
   * and on the performance channel evidence. Default "proof" (no profile claimed).
   */
  qualityProfile?: string;
  /** Fixed ISO timestamp for deterministic fixture generation. */
  fixedTimestampIso?: string;
}

function blockageResult(
  code: "PLAYWRIGHT_UNAVAILABLE" | "CHROME_UNAVAILABLE" | "SURFACE_CONTRACT_INVALID" | "SCENARIO_ERROR",
  message: string,
  opts: RunScenarioOptions,
  runId: string,
  timestampIso: string
): ScenarioRunResult {
  const sink =
    opts.sink ??
    new DirectoryRunSink(opts.outDir ?? join(".tmp", "gauntlet-proof-runs"));
  const run: ObservationRunDraft = {
    id: runId,
    project_revision: opts.projectRevision,
    scenario_id: opts.scenario.id,
    environment: {
      browser: "chrome",
      browser_version: "unavailable",
      headless: opts.headless ?? true,
      viewport: opts.scenario.viewport ?? { width: 640, height: 360 },
      platform: process.platform,
      quality_profile: opts.qualityProfile ?? "proof",
      executable_path: opts.chromeExecutablePath ?? DEFAULT_CHROME_PATH,
      autoplay_bypass_flags: false,
    },
    channels: [{ channel: "none", reason: code }],
    seed: opts.scenario.seed,
    timestamp: timestampIso,
  };
  const artifacts: ArtifactRecord[] = [];
  let runDir: string | undefined;
  try {
    sink.begin(run);
    const record = sink.writeArtifact(
      "blockage.json",
      JSON.stringify({ code, message, run_id: runId, scenario_id: opts.scenario.id }, null, 2) + "\n",
      "blockage-report"
    );
    artifacts.push(record);
    const manifest: EvidenceManifestDraft = {
      id: `${runId}-manifest-01`,
      run_id: runId,
      project_revision: opts.projectRevision,
      requirement_ids: opts.requirementIds,
      artifacts,
      result: "blocked",
      contradictions: undefined,
      created_at: timestampIso,
    };
    sink.complete(manifest);
    runDir = sink instanceof DirectoryRunSink ? sink.runDir ?? undefined : undefined;
    return { status: "blocked", blockage: { code, message }, run, manifest, channels: [], run_dir: runDir };
  } catch (sinkErr) {
    // A sink failure during blockage recording must not mask the primary blockage.
    return {
      status: "blocked",
      blockage: {
        code,
        message: `${message} (additional: blockage could not be persisted: ${
          sinkErr instanceof Error ? sinkErr.message : String(sinkErr)
        })`,
      },
      run,
      channels: [],
    };
  }
}

/**
 * Runs one deterministic browser observation. Never interprets expectations.
 * Returns a typed blocked result (not an exception) when required browser proof
 * cannot run in this environment.
 */
export async function runScenario(opts: RunScenarioOptions): Promise<ScenarioRunResult> {
  assertScenarioId(opts.scenario.id);
  if (!opts.projectRevision) throw new Error("projectRevision is required for every observation run");
  if (opts.requirementIds.length === 0) {
    throw new Error("requirementIds must declare at least one requirement the evidence supports");
  }

  const timestampIso = opts.fixedTimestampIso ?? new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const runId = makeRunId(opts.scenario.id, opts.projectRevision, timestampIso);
  const headless = opts.headless ?? true;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const chromePath = opts.chromeExecutablePath ?? DEFAULT_CHROME_PATH;

  // TEETH-T20-003 seam: Playwright unavailability yields typed blocked, never passed.
  let playwright: typeof import("playwright");
  try {
    playwright = await (opts.playwrightLoader ?? defaultPlaywrightLoader)();
  } catch (err) {
    return blockageResult(
      "PLAYWRIGHT_UNAVAILABLE",
      `Playwright is unavailable; required browser proof is blocked, never passed (RECOV-004): ${
        err instanceof Error ? err.message : String(err)
      }`,
      opts,
      runId,
      timestampIso
    );
  }

  if (!existsSync(chromePath)) {
    return blockageResult(
      "CHROME_UNAVAILABLE",
      `system Chrome not found at ${chromePath}; browser proof is blocked, never passed (RECOV-004)`,
      opts,
      runId,
      timestampIso
    );
  }

  // Serve inline fixture HTML over loopback (deterministic, no external network).
  let server: ReturnType<typeof Bun.serve> | null = null;
  const url = opts.scenario.url ?? null;
  if (!url && opts.scenario.html) {
    server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(opts.scenario.html as string, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    });
  }
  const targetUrl = url ?? `http://127.0.0.1:${server!.port}/?scenario=${encodeURIComponent(opts.scenario.id)}`;

  const browser = await playwright.chromium.launch({
    executablePath: chromePath,
    headless,
    // Deliberately NO autoplay-policy bypass flags and no render-policy overrides.
    args: ["--no-default-browser-check"],
  });

  const sink = opts.sink ?? new DirectoryRunSink(opts.outDir ?? join(".tmp", "gauntlet-proof-runs"));
  const consoleEntries: ConsoleEntry[] = [];
  const pageErrors: string[] = [];
  const responses: Array<{ url: string; status: number; ok: boolean }> = [];

  try {
    let traceBytes: Uint8Array | null = null;
    const context = await browser.newContext({
      viewport: opts.scenario.viewport ?? { width: 640, height: 360 },
      deviceScaleFactor: 1,
    });
    if (opts.captureTrace) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    }
    const page = await context.newPage();

    // Collectors attached BEFORE navigation (telemetry/network channels).
    page.on("console", (msg) => {
      consoleEntries.push({ type: msg.type(), text: msg.text() });
    });
    page.on("pageerror", (err) => {
      pageErrors.push(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    });
    page.on("response", (res) => {
      responses.push({ url: res.url(), status: res.status(), ok: res.ok() });
    });

    await page.goto(targetUrl, { waitUntil: "load", timeout: timeoutMs });

    // Stable-surface validation: missing stable methods fail here; never DOM fallbacks.
    await waitForSurface(page, timeoutMs);
    const validation = await validateMountedSurface(page);
    if (!validation.valid) {
      await context.close();
      return blockageResult(
        "SURFACE_CONTRACT_INVALID",
        `mounted surface failed __GAUNTLET_STUDIO_OBS__ v1 validation: ${validation.problems.join("; ")}`,
        opts,
        runId,
        timestampIso
      );
    }

    const client = new StableSurfaceClient(page);
    if (!(await client.ready())) {
      await context.close();
      return blockageResult("SCENARIO_ERROR", "surface reported not ready", opts, runId, timestampIso);
    }

    // Deterministic drive: reset -> seed -> view -> bounded step -> pause -> settle.
    await client.controlResetScenario(opts.scenario.id);
    const seed = opts.scenario.seed;
    if (seed !== undefined) await client.controlSetSeed(seed);
    const viewName = opts.scenario.view ?? "main";
    const viewOk = await client.controlSetView(viewName);
    if (!viewOk) {
      await context.close();
      return blockageResult(
        "SCENARIO_ERROR",
        `named view '${viewName}' was not available on the stable surface`,
        opts,
        runId,
        timestampIso
      );
    }
    const steps = opts.scenario.steps ?? DEFAULT_STEPS;
    const tickAfterSteps = await client.controlStep(steps);
    await client.controlPause();
    await client.settleFrame();

    // ----- Channel observation (observation only; no interpretation here).
    // Everything is captured in memory FIRST so the run draft is complete
    // (ObservationRun requires its channels) when the sink begins writing.
    const artifacts: ArtifactRecord[] = [];

    // state channel — Koota-backed stable reads only.
    const snapshot = await client.stateSnapshot();
    const tick = await client.tick();
    const stateEvidence: StateChannelEvidence = {
      channel: "state",
      source: "koota",
      snapshot: snapshot as unknown as SemanticStateSnapshot,
      tick,
      read_via: ["entities.snapshot()", "tick()"],
    };

    // pixels channel — fresh rendered capture for the named view, after pause/step/render.
    const shot = new Uint8Array(await page.screenshot({ type: "png" }));
    const dims = pngDimensions(shot);
    const pixelCapture: PixelCapture = {
      view: viewName,
      artifact: "artifacts/screenshot-main.png",
      sha256: sha256Hex(shot),
      width: dims?.width ?? 0,
      height: dims?.height ?? 0,
      bytes: shot.byteLength,
    };
    const pixelsEvidence: PixelsChannelEvidence = {
      channel: "pixels",
      captures: [pixelCapture],
    };

    // telemetry channel — console/page diagnostics plus tick consequence.
    const telemetryEvidence: TelemetryChannelEvidence = {
      channel: "telemetry",
      console: consoleEntries,
      page_errors: pageErrors,
      tick_after_steps: tickAfterSteps,
    };

    // network channel (where applicable) — observed responses + surface network read.
    const networkSurface = await client.networkRead();
    const networkEvidence: NetworkChannelEvidence = {
      channel: "network",
      responses,
      surface_read: networkSurface,
    };

    // renderer identity (REQ-BIND-010) and performance metrics (T21) through the
    // stable renderer probe/stats seams only.
    const rendererProbe = await client.rendererProbe();
    const qualityProfile = opts.qualityProfile ?? "proof";
    let statsRead: { present: boolean; reason?: string; stats?: Record<string, unknown> } = {
      present: false,
      reason: "not read (no performance capture requested)",
    };
    if (opts.qualityProfile) {
      statsRead = (await client.rendererStats()) as {
        present: boolean;
        reason?: string;
        stats?: Record<string, unknown>;
      };
    }
    // JS-heap memory observation (T21 hardening): Chrome `performance.memory`
    // (usedJSHeapSize/jsHeapSizeLimit) read through the page-evaluation seam —
    // observation only, same discipline as every other channel capture. Browsers or
    // contexts that expose no reading yield null; the absence is then recorded in
    // the evidence `unreported` list (a declared max_memory_mb budget fails
    // evaluation as unreported — it can never silently pass).
    let memoryRead: { usedJSHeapSize?: unknown; jsHeapSizeLimit?: unknown } | null = null;
    if (opts.qualityProfile) {
      memoryRead = (await page
        .evaluate(`(() => {
          const mem = (performance).memory;
          if (!mem || typeof mem !== "object") return null;
          return { usedJSHeapSize: mem.usedJSHeapSize, jsHeapSizeLimit: mem.jsHeapSizeLimit };
        })()`)
        .catch(() => null)) as { usedJSHeapSize?: unknown; jsHeapSizeLimit?: unknown } | null;
    }
    const performanceEvidence = capturePerformanceEvidence({
      quality_profile: qualityProfile,
      rendererStats: statsRead.present ? statsRead.stats ?? null : null,
      rendererStatsReason: statsRead.reason,
      rendererIdentity: (rendererProbe.identity ?? undefined) as Record<string, unknown> | undefined,
      console_errors: consoleEntries.filter((e) => e.type === "error" || e.type === "warning").length,
      memory: memoryRead,
    });

    if (opts.captureTrace) {
      const tmpTrace = join(tmpdir(), `gauntlet-trace-${runId}.zip`);
      await context.tracing.stopChunk({ path: tmpTrace });
      await context.tracing.stop();
      if (existsSync(tmpTrace)) {
        traceBytes = new Uint8Array(await Bun.file(tmpTrace).arrayBuffer());
        rmSync(tmpTrace, { force: true });
      }
    }
    await context.close();

    const channels: ChannelEvidence[] = [stateEvidence, pixelsEvidence, telemetryEvidence, networkEvidence, performanceEvidence];

    const run: ObservationRunDraft = {
      id: runId,
      project_revision: opts.projectRevision,
      scenario_id: opts.scenario.id,
      environment: {
        browser: "chrome",
        browser_version: browser.version(),
        headless,
        viewport: opts.scenario.viewport ?? { width: 640, height: 360 },
        platform: process.platform,
        quality_profile: qualityProfile,
        executable_path: chromePath,
        autoplay_bypass_flags: false,
        renderer_identity: (rendererProbe.identity ?? undefined) as Record<string, unknown> | undefined,
      },
      channels: channels as Array<string | Record<string, unknown>>,
      seed,
      camera_views: [viewName],
      timestamp: timestampIso,
    };

    sink.begin(run);
    artifacts.push(
      sink.writeArtifact(
        "state-snapshot.json",
        JSON.stringify(stateEvidence, null, 2) + "\n",
        "state-snapshot"
      )
    );
    artifacts.push(sink.writeArtifact("screenshot-main.png", shot, "rendered-capture"));
    artifacts.push(
      sink.writeArtifact("telemetry.json", JSON.stringify(telemetryEvidence, null, 2) + "\n", "telemetry")
    );
    artifacts.push(
      sink.writeArtifact("network.json", JSON.stringify(networkEvidence, null, 2) + "\n", "network")
    );
    artifacts.push(
      sink.writeArtifact(
        "performance-metrics.json",
        JSON.stringify(performanceEvidence, null, 2) + "\n",
        "performance-metrics"
      )
    );
    artifacts.push(
      sink.writeArtifact(
        "renderer-probe.json",
        JSON.stringify(rendererProbe, null, 2) + "\n",
        "renderer-identity"
      )
    );
    if (traceBytes) {
      artifacts.push(sink.writeArtifact("trace.zip", traceBytes, "playwright-trace"));
    }

    const manifest: EvidenceManifestDraft = {
      id: `${runId}-manifest-01`,
      run_id: runId,
      project_revision: opts.projectRevision,
      requirement_ids: opts.requirementIds,
      artifacts,
      // Observation-level outcome: evidence was fully obtained. Interpretation of
      // frozen expectations is deliberately NOT this field (studio gauntlet module);
      // a fully-observed contradictory run is still a complete observation.
      result: "pass",
      contradictions: pageErrors.length > 0 ? [`page errors observed during run: ${pageErrors.length}`] : undefined,
      created_at: timestampIso,
    };
    sink.complete(manifest);

    return {
      status: "observed",
      run,
      manifest,
      channels,
      run_dir: sink instanceof DirectoryRunSink ? sink.runDir ?? undefined : undefined,
    };
  } catch (err) {
    return blockageResult(
      "SCENARIO_ERROR",
      `scenario execution failed: ${err instanceof Error ? err.message : String(err)}`,
      opts,
      runId,
      timestampIso
    );
  } finally {
    await browser.close().catch(() => undefined);
    if (server) server.stop(true);
  }
}

async function defaultPlaywrightLoader(): Promise<typeof import("playwright")> {
  return import("playwright");
}
