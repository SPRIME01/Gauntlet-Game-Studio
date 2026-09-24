#!/usr/bin/env bun
/**
 * @gauntlet/studio-cli
 * Command-line interface for Gauntlet Game Studio.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  getDoctorStudioResult,
  loadStudioConfig,
  defaultCapabilityRegistry,
  routeCapability,
  settleAgentHandoff,
  lintStudioSkillSurface,
  loadSkillOverlayPolicy,
  createGameProject,
  AssetRegistry,
  EvidenceStore,
  RevisionUnavailableError,
  resolveProjectRevision,
  parseFrozenExpectation,
  settleExpectation,
  loadQualityProfiles,
  bindQualityProfile,
  QualityProfileError,
  AssetResolver,
  defaultRecipeRegistry,
  compileRecipe,
  applyRecipe,
  RecipeCompileError,
  type AssetSourceProvider,
  type AssetBudgetSummary,
  type FrozenExpectation,
  type SettlementOutcome,
  type ResolvedQualityProfile,
} from "@gauntlet/studio";
import {
  validateCapabilityResult,
  validateCapabilityRequest,
  type StudioResult,
  type CapabilityRequest,
  type AgentHandoff,
  type ArtifactRef,
} from "@gauntlet/contracts";
import {
  assertWorldCompositionIntentBoundary,
  verifyWorldCompositionResultFile,
  WORLD_ENVIRONMENT_COMPOSE_CAPABILITY,
} from "@gauntlet/adapters";
import {
  ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY,
  prepareReferenceImageReconstruction,
  verifyImg2ThreeJsResult,
} from "@gauntlet/adapters";
import {
  DCC_BLENDER_PROCESS_CAPABILITY,
  prepareBlenderProcess,
  verifyBlenderProcessResult,
} from "@gauntlet/adapters";
import {
  buildFixtureScenario,
  runScenario,
  PolyHavenAssetSource,
  type ChannelEvidence,
  type ScenarioRunResult,
} from "@gauntlet/adapters";

export const CLI_VERSION = "0.3.0";

/** Monorepo root (this CLI lives at apps/studio-cli/src). */
const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const PROOF_EXPECTATIONS_DIR = path.join(REPO_ROOT, "packages", "studio", "test", "proof", "expectations");
const PROOF_FIXTURES_DIR = path.join(REPO_ROOT, "packages", "studio", "test", "proof", "fixtures");
const PERFORMANCE_EXPECTATIONS_DIR = path.join(REPO_ROOT, "packages", "studio", "test", "performance", "expectations");
/**
 * Reference-game project spec that OWNS the numeric quality profiles (REQ-CONFIG-005):
 * the Blackwater Relay reference game declares its profiles before they are used as
 * gates; fixture scenarios gate against those same game-owned numbers.
 */
const REFERENCE_GAME_SPEC = path.join(REPO_ROOT, "examples", "blackwater-relay", ".agents", "specs", "game.spec.yaml");

/** Reads a `--flag <value>` option pair; returns undefined when absent. */
function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && typeof args[idx + 1] === "string" ? args[idx + 1] : undefined;
}

/**
 * Resolves the project revision for evidence freshness; maps typed failures onto a
 * structured blocked result with the stable blocked exit code 2.
 */
function revisionOrBlocked(operation: string, explicit?: string): { revision?: string; blocked?: StudioResult } {
  try {
    return { revision: resolveProjectRevision(process.cwd(), { explicit }) };
  } catch (err) {
    if (err instanceof RevisionUnavailableError) {
      return {
        blocked: {
          status: "blocked",
          operation,
          diagnostics: { code: err.code, error: err.message },
        },
      };
    }
    throw err;
  }
}

/** Resolves a frozen expectation by id (committed fixture) or explicit JSON path. */
function loadFrozenExpectation(idOrPath: string): FrozenExpectation {
  const candidate = path.resolve(process.cwd(), idOrPath);
  const searchDirs = [PROOF_EXPECTATIONS_DIR, PERFORMANCE_EXPECTATIONS_DIR];
  const found = searchDirs.map((dir) => path.join(dir, `${idOrPath}.json`)).find((file) => fs.existsSync(file));
  const file = fs.existsSync(candidate) ? candidate : found;
  if (!file) {
    throw new Error(
      `frozen expectation '${idOrPath}' not found (committed expectations: ${searchDirs.join(", ")})`
    );
  }
  return parseFrozenExpectation(JSON.parse(fs.readFileSync(file, "utf-8")));
}

/**
 * Resolves the DECLARED quality profile for a performance claim (T21). Numeric
 * budgets come from the game project spec — never from adapters or CLI defaults.
 */
function resolvePerformanceProfile(
  expectation: FrozenExpectation,
  gameSpecPath: string
): { profile: ResolvedQualityProfile; game_spec: string } {
  if (!expectation.performance) {
    throw new Error(`frozen expectation '${expectation.id}' claims no performance channel`);
  }
  const profiles = loadQualityProfiles(gameSpecPath);
  const declared = Object.prototype.hasOwnProperty.call(profiles, expectation.performance.profile);
  if (!declared) {
    throw new QualityProfileError(
      "PROFILE_NOT_DECLARED",
      `quality profile '${expectation.performance.profile}' is not declared by game spec '${gameSpecPath}'; profiles MUST be declared before use as gates (REQ-PERF-002)`
    );
  }
  return { profile: bindQualityProfile(profiles, expectation.performance.profile), game_spec: gameSpecPath };
}

/** Game spec that owns the numeric profiles (override with --game-spec). */
function gameSpecOrDefault(explicit?: string): string {
  return explicit ? path.resolve(process.cwd(), explicit) : REFERENCE_GAME_SPEC;
}

/** Maps a harness observation onto the settlement input channels. */
function settleObserved(
  expectation: FrozenExpectation,
  observed: ScenarioRunResult,
  currentRevision: string,
  now?: string,
  performance?: { profile: ResolvedQualityProfile; asset_summary?: AssetBudgetSummary | null } | null
): SettlementOutcome {
  const run = observed.run ? (JSON.parse(JSON.stringify(observed.run)) as never) : null;
  const manifests = observed.manifest ? [JSON.parse(JSON.stringify(observed.manifest)) as never] : [];
  const channels: ChannelEvidence[] = observed.channels ?? [];
  return settleExpectation({
    expectation,
    run,
    manifests,
    channels,
    availability: {
      browser_proof_available: observed.status === "observed",
      unavailable_reason: observed.blockage?.message,
    },
    currentRevision,
    performance: performance ?? null,
    now,
  });
}

/**
 * Serves a built game project over loopback for browser verification (T22 suite mode):
 * `/` + `/game.js` from `<project>/dist`, `/assets/*` from the committed asset store,
 * and a favicon so page-driven network evidence is all-OK by construction.
 */
function serveProjectGame(projectRoot: string): { url: string; stop: () => void } {
  const distDir = path.join(projectRoot, "dist");
  const assetsDir = path.join(projectRoot, "assets");
  const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".glb": "model/gltf-binary",
    ".ico": "image/x-icon",
  };
  const favicon = Uint8Array.from([
    0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x18, 0x00, 0x30, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00,
    0x00, 0x00, 0x01, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/" || pathname === "/index.html") {
        return new Response(fs.readFileSync(path.join(distDir, "index.html")), {
          headers: { "content-type": MIME[".html"] },
        });
      }
      if (pathname === "/game.js") {
        return new Response(fs.readFileSync(path.join(distDir, "game.js")), {
          headers: { "content-type": MIME[".js"] },
        });
      }
      // T23 project-runner observation mode: game-declared networked client page.
      if (pathname === "/net.html") {
        return new Response(fs.readFileSync(path.join(distDir, "net.html")), {
          headers: { "content-type": MIME[".html"] },
        });
      }
      if (pathname === "/net-client.js") {
        return new Response(fs.readFileSync(path.join(distDir, "net-client.js")), {
          headers: { "content-type": MIME[".js"] },
        });
      }
      if (pathname === "/favicon.ico") {
        return new Response(favicon, { headers: { "content-type": MIME[".ico"] } });
      }
      if (pathname.startsWith("/assets/")) {
        const file = path.resolve(assetsDir, pathname.slice("/assets/".length));
        if (!file.startsWith(assetsDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return new Response("not found", { status: 404 });
        }
        const ext = path.extname(file).toLowerCase();
        return new Response(fs.readFileSync(file), {
          headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

/** Structured payload of one game-project suite verification (T22). */
interface SuiteVerifyPayload {
  suite: string;
  project: string;
  project_revision: string;
  game_spec: string;
  evidence_store: string;
  scenarios: SuiteScenarioResult[];
  totals: { settled: number; failed: number; blocked: number; incomplete: number };
  all_settled: boolean;
}

interface SuiteScenarioResult {  scenario: string;
  decision: string;
  blockage_class?: string;
  reason: string;
  requirement_ids: string[];
  run_id?: string;
  run_dir?: string;
  settlement_path?: string;
  channel_verdicts: Array<{ channel: string; evaluated: boolean; pass: boolean; failed_checks: unknown[] }>;
}

/**
 * T22 suite verification: runs a game project's committed named-scenario suite
 * (`<project>/.agents/suites/<suite>.yaml`) through the T20/T21 evidence + Gauntlet
 * machinery with a fresh ObservationRun, EvidenceManifest, and SettlementRecord per
 * scenario. Frozen expectations are committed under the game project BEFORE evidence.
 */
async function runGameSuiteVerify(projectRoot: string, suiteName: string): Promise<StudioResult> {
  const manifestPath = path.join(projectRoot, ".agents", "suites", `${suiteName}.yaml`);
  const manifest = Bun.YAML.parse(fs.readFileSync(manifestPath, "utf-8")) as {
    suite?: string;
    expectations?: Array<{ scenario: string; file: string }>;
    // T23 project-runner observation mode (declared by the game's suite manifest).
    observation?: { mode?: string; module?: string; export?: string; server?: { script?: string } };
  };
  if (manifest?.suite !== suiteName || !Array.isArray(manifest.expectations) || manifest.expectations.length === 0) {
    throw new Error(`suite manifest '${manifestPath}' declares no expectations to verify`);
  }
  const revision = resolveProjectRevision(projectRoot);
  const gameSpec = path.join(projectRoot, ".agents", "specs", "game.spec.yaml");
  const profiles = loadQualityProfiles(gameSpec);
  const store = new EvidenceStore({ projectRoot });

  // T23: when the manifest declares a project-runner observation, the game project owns
  // the observation step (e.g. two independent browser clients + authoritative headless
  // server for the multiplayer suite). Evidence still flows through the same canonical
  // sink and settlement machinery; only the single-page observation call is replaced.
  const observation = manifest.observation;
  let observeScenario: ((ctx: Record<string, unknown>) => Promise<ScenarioRunResult>) | null = null;
  let serverScript: string | null = null;
  if (observation?.mode === "project-runner" && observation.module) {
    const observationModule = path.resolve(projectRoot, observation.module);
    const mod = (await import(observationModule)) as Record<string, unknown>;
    const observe = mod[observation.export ?? "observeScenario"];
    if (typeof observe !== "function") {
      throw new Error(`observation module '${observationModule}' does not export '${observation.export ?? "observeScenario"}'`);
    }
    observeScenario = observe as (ctx: Record<string, unknown>) => Promise<ScenarioRunResult>;
    serverScript = path.resolve(projectRoot, observation.server?.script ?? "src/server.ts");
  }

  let assetSummary: AssetBudgetSummary | null = null;
  const registry = new AssetRegistry(projectRoot);
  if (registry.exists()) {
    registry.load();
    assetSummary = { not_acceptable: registry.verifyAll().totals.not_acceptable };
  }

  const results: SuiteScenarioResult[] = [];
  const served = serveProjectGame(projectRoot);
  try {
    for (const entry of manifest.expectations) {
      const expectationFile = path.resolve(projectRoot, entry.file);
      const expectation = parseFrozenExpectation(
        JSON.parse(fs.readFileSync(expectationFile, "utf-8"))
      );
      if (expectation.scenario_id !== entry.scenario) {
        throw new Error(
          `suite entry '${entry.scenario}' binds expectation '${expectation.id}' for scenario '${expectation.scenario_id}'`
        );
      }
      const profile = expectation.performance
        ? bindQualityProfile(profiles, expectation.performance.profile)
        : null;
      const observed =
        observeScenario && serverScript
          ? await observeScenario({
              projectRoot,
              pageUrl: served.url,
              serverScript,
              scenarioId: entry.scenario,
              seed: expectation.seed,
              steps: expectation.steps,
              view: expectation.view,
              projectRevision: revision,
              requirementIds: [...expectation.requirement_ids],
              headless: !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
              timeoutMs: 90000,
              sink: store.createRunWriter(),
            })
          : await runScenario({
              scenario: {
                id: entry.scenario,
                url: `${served.url}/`,
                seed: expectation.seed,
                steps: expectation.steps,
                view: expectation.view,
              },
              projectRevision: revision,
              requirementIds: [...expectation.requirement_ids],
              sink: store.createRunWriter(),
              headless: !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
              timeoutMs: 90000,
              ...(expectation.performance ? { qualityProfile: expectation.performance.profile } : {}),
            });
      const outcome = settleObserved(
        expectation,
        observed,
        revision,
        undefined,
        profile ? { profile, asset_summary: assetSummary } : null
      );
      let settlementPath: string | undefined;
      if (observed.run && outcome.record) {
        store.appendSettlement(observed.run.id, outcome.record);
        settlementPath = path.join(store.runDir(observed.run.id), "settlement-01.json");
      }
      results.push({
        scenario: entry.scenario,
        decision: outcome.decision,
        ...(outcome.blockage_class ? { blockage_class: outcome.blockage_class } : {}),
        reason: outcome.reason,
        requirement_ids: [...expectation.requirement_ids],
        ...(observed.run ? { run_id: observed.run.id } : {}),
        ...(observed.run_dir ?? (observed.run ? store.runDir(observed.run.id) : undefined)
          ? { run_dir: observed.run_dir ?? store.runDir(observed.run!.id) }
          : {}),
        ...(settlementPath ? { settlement_path: settlementPath } : {}),
        channel_verdicts: outcome.channel_verdicts.map((v) => ({
          channel: v.channel,
          evaluated: v.evaluated,
          pass: v.pass,
          failed_checks: v.checks.filter((c) => !c.pass),
        })),
      });
    }
  } finally {
    served.stop();
  }

  const totals = {
    settled: results.filter((r) => r.decision === "settled").length,
    failed: results.filter((r) => r.decision === "failed").length,
    blocked: results.filter((r) => r.decision === "blocked").length,
    incomplete: results.filter((r) => r.decision === "incomplete").length,
  };
  const status: StudioResult["status"] =
    totals.settled === results.length ? "success" : totals.failed > 0 ? "failed" : "blocked";
  const payload: SuiteVerifyPayload = {
    suite: suiteName,
    project: projectRoot,
    project_revision: revision,
    game_spec: gameSpec,
    evidence_store: store.runsRoot,
    scenarios: results,
    totals,
    all_settled: totals.settled === results.length,
  };
  return {
    status,
    operation: "studio.verify-suite",
    result: payload,
    diagnostics: {
      fresh_observation: true,
      settlement_append_only: true,
      exit_code_semantics: "0=settled 1=failed 2=blocked/incomplete",
    },
  };
}

/**
 * T25 `--suite all`: runs EVERY game-declared suite in `<project>/.agents/suites/`
 * (each `*.yaml` whose parsed `suite` name does not start with `teeth-`; `teeth-*`
 * files are preregistered falsification fixtures, not conformance suites) through
 * the unchanged per-suite machinery above — fresh ObservationRun + EvidenceManifest
 * + SettlementRecord per scenario. The aggregate settles only when every declared
 * suite settles; exit-code semantics stay 0=settled 1=failed 2=blocked/incomplete.
 */
async function runGameSuiteAll(projectRoot: string): Promise<StudioResult> {
  const suitesDir = path.join(projectRoot, ".agents", "suites");
  if (!fs.existsSync(suitesDir)) {
    throw new Error(`project has no suites directory '${suitesDir}'`);
  }
  const suiteNames = fs
    .readdirSync(suitesDir)
    .filter((f) => f.endsWith(".yaml") && !f.startsWith("teeth-"))
    .map((f) => f.replace(/\.yaml$/, ""))
    .sort();
  if (suiteNames.length === 0) {
    throw new Error(`project declares no game suites in '${suitesDir}'`);
  }
  const suites: Array<SuiteVerifyPayload & { studio_status: StudioResult["status"] }> = [];
  for (const suiteName of suiteNames) {
    const result = await runGameSuiteVerify(projectRoot, suiteName);
    suites.push({ ...(result.result as SuiteVerifyPayload), studio_status: result.status });
  }
  const totals = suites.reduce(
    (acc, s) => ({
      settled: acc.settled + s.totals.settled,
      failed: acc.failed + s.totals.failed,
      blocked: acc.blocked + s.totals.blocked,
      incomplete: acc.incomplete + s.totals.incomplete,
    }),
    { settled: 0, failed: 0, blocked: 0, incomplete: 0 }
  );
  const scenarioCount = suites.reduce((n, s) => n + s.scenarios.length, 0);
  const allSettled = totals.settled === scenarioCount && scenarioCount > 0;
  const anyFailed = totals.failed > 0;
  const status: StudioResult["status"] = allSettled ? "success" : anyFailed ? "failed" : "blocked";
  return {
    status,
    operation: "studio.verify-suite-all",
    result: {
      suite: "all",
      suites: suiteNames,
      project: projectRoot,
      project_revision: suites[0]?.project_revision,
      results: suites,
      totals,
      all_settled: allSettled,
    },
    diagnostics: {
      fresh_observation: true,
      settlement_append_only: true,
      exit_code_semantics: "0=settled 1=failed 2=blocked/incomplete",
    },
  };
}

/**
 * The project root for a file under `.studio/requests|results` is the directory
 * directly containing `.studio`; otherwise fall back to the process cwd (T14).
 */
function projectRootForFile(filePath: string): string {
  let cur = path.dirname(path.resolve(process.cwd(), filePath));
  for (;;) {
    if (path.basename(cur) === ".studio") return path.dirname(cur);
    const parent = path.dirname(cur);
    if (parent === cur) return process.cwd();
    cur = parent;
  }
}

/** Walk up from a file's directory to the monorepo root (workspaces package.json). */
function repoRootForFile(filePath: string): string {
  const start = path.resolve(process.cwd(), filePath);
  let cur = path.dirname(start);
  const startDir = cur;
  for (;;) {
    const pkgPath = path.join(cur, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const workspaces = parsed.workspaces;
        if (Array.isArray(workspaces) && workspaces.some((w: unknown) => typeof w === "string" && w.includes("packages/*"))) {
          return cur;
        }
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) return startDir;
    cur = parent;
  }
}

/**
 * Loads a capability request/result file (YAML or JSON) relative to the process cwd.
 * Used by the file-based `capability prepare|verify-result <capability-id> <file>` form.
 */
function loadCapabilityFile(filePath: string): unknown {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Capability file not found: ${resolved}`);
  }
  const text = fs.readFileSync(resolved, "utf-8");
  if (resolved.endsWith(".json")) {
    return JSON.parse(text);
  }
  return Bun.YAML.parse(text);
}

function printHelp() {
  console.log(`
Gauntlet Game Studio Semantic CLI (v${CLI_VERSION})

Usage:
  studio <command> [subcommand/args] [options]

Commands:
  doctor                       Validate development environment and prerequisites
  config                       Inspect resolved configuration
  create <name>                Scaffold a new game project
  capabilities                 List registered studio capabilities
  recipes                       List canonical outcome recipes (intent → recipe → capabilities)
  recipe describe <id>          Show a recipe: use/when, inputs, defaults, affordances, acceptance
  recipe plan <id> [k=v...]     Dry-run compile to an inspectable RecipePlan (no mutation)
  recipe apply <id> [k=v...]    Apply a recipe through existing capabilities; writes append-only
                               provenance under .studio/recipe-provenance.jsonl
                               --project <dir> targets the game project root
  capability <prepare|accept|verify-result> [args]
                               Prepare, accept, or verify capability results.
                               File form (T15): capability prepare|verify-result <capability-id> <file.yaml>
                               e.g. world.environment.compose requests/results under .studio/
  asset verify --all           Verify the project Asset Registry: provenance, acceptance gates
  asset <other-action>         Asset compiler/source actions (typed placeholders until settled)
  observe [scenario]           Observe a deterministic proof scenario via the Playwright harness
                               (system Chrome, stable observability methods only); writes immutable
                               run evidence under artifacts/runs/<run-id>/  [T20]
                               --profile <id> captures performance metrics under a game-declared
                               quality profile  [T21]
  verify <expectation>         Verify a frozen expectation against a fresh observation and append a
                               SettlementRecord (settled|blocked|failed|incomplete)  [T20]
  verify --scenario <id>       Performance verification under a game-project-declared quality
    --profile <id>             profile (declared BEFORE use as a gate; numeric budgets live in the
                               game project)  [T21]
  verify --project <dir>       Run a game project's committed named-scenario suite (fresh evidence
    --suite <name|all>         per scenario); 'all' runs every game-declared suite (teeth-* fixtures
                               excluded)  [T22/T25]
  evidence check-fixtures      Validate committed evidence fixtures: schemas, run/manifest correlation,
                               artifact hashes, and negative controls (must-reject)  [T20]
  evidence <other-action>      Other evidence actions (typed placeholders until settled)

Global Options:
  --json                       Emit structured machine-readable JSON output
  --help, -h                   Show this help message
`);
}

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const isJson = args.includes("--json");
  const filteredArgs = args.filter((a) => a !== "--json");
  const command = filteredArgs[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  switch (command) {
    case "doctor": {
      const result: StudioResult = await getDoctorStudioResult(process.cwd());
      if (isJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n=== Gauntlet Studio Doctor (v${CLI_VERSION}) ===`);
        const report = result.result as any;
        for (const check of report.checks) {
          const mark = check.status === "pass" ? "✓" : check.status === "warn" ? "⚠" : "✗";
          console.log(` ${mark} [${check.name}] ${check.details}`);
        }
        console.log(`\nOverall Status: ${result.status.toUpperCase()}\n`);
      }
      return result.status === "success" ? 0 : 1;
    }

    case "config": {
      try {
        const config = loadStudioConfig(process.cwd());
        const masked = { ...config, secrets: Object.fromEntries(Object.keys(config.secrets).map((k) => [k, "[REDACTED]"])) };
        const res: StudioResult = {
          status: "success",
          operation: "studio.config",
          result: masked,
          diagnostics: { source: "gauntlet.config.json or defaults" },
        };
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(JSON.stringify(masked, null, 2));
        }
        return 0;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as any).code || "CONFIG_ERROR";
        const res: StudioResult = {
          status: "failed",
          operation: "studio.config",
          diagnostics: { error: msg, code },
        };
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.error(`Error: ${msg}`);
        }
        return 1;
      }
    }

    case "create": {
      const targetArg = filteredArgs[1] || "new-game";
      try {
        const created = createGameProject(targetArg);
        const res: StudioResult = {
          status: "success",
          operation: "studio.create",
          result: created,
          diagnostics: {
            project_name: created.project_name,
            path: created.path,
            files_count: created.files.length,
          },
        };
        if (isJson) console.log(JSON.stringify(res, null, 2));
        else console.log(`Created independent game project '${created.project_name}' at ${created.path} (${created.files.length} files)`);
        return 0;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const res: StudioResult = {
          status: "failed",
          operation: "studio.create",
          diagnostics: { error: msg },
        };
        if (isJson) console.log(JSON.stringify(res, null, 2));
        else console.error(`Error: ${msg}`);
        return 1;
      }
    }

    case "capabilities": {
      const sub = filteredArgs[1];
      if (sub === "lint") {
        // T16 (REQ-BIND-007): lint the full discoverable skill surface — registered studio
        // capabilities plus studio-owned overlay policy enforcement (forbidden upstream director,
        // quarantined generators, specialist binding/routing-collision checks).
        let report;
        try {
          const overlayPolicy = loadSkillOverlayPolicy(path.resolve(import.meta.dir, "../../.."));
          report = lintStudioSkillSurface(defaultCapabilityRegistry.list(), overlayPolicy);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          report = {
            valid: false,
            issues: [
              {
                severity: "error" as const,
                code: "OVERLAY_POLICY_UNAVAILABLE",
                message: `Studio-owned overlay policy could not be loaded/enforced: ${msg}`,
                skill_id: "threejs-game-skills",
              },
            ],
          };
        }
        const res: StudioResult = {
          status: report.valid ? "success" : "failed",
          operation: "studio.capabilities.lint",
          result: report,
          diagnostics: {
            valid: report.valid,
            total_issues: report.issues.length,
          },
        };
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(`\n=== Capability & Skill Metadata Lint Report ===`);
          console.log(`Status: ${report.valid ? "VALID" : "INVALID"}`);
          for (const issue of report.issues) {
            console.log(` [${issue.severity.toUpperCase()}] ${issue.skill_id}: ${issue.message}`);
          }
          console.log("");
        }
        return report.valid ? 0 : 1;
      }

      const caps = defaultCapabilityRegistry.list();
      const res: StudioResult = {
        status: "success",
        operation: "studio.capabilities",
        result: caps,
        diagnostics: { total: caps.length },
      };
      if (isJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`\n=== Registered Studio Capabilities (${caps.length}) ===`);
        for (const c of caps) {
          console.log(` • ${c.id.padEnd(22)} [${c.providers.join(", ")}]`);
          console.log(`   ${c.summary}`);
        }
        console.log("");
      }
      return 0;
    }

    case "recipes": {
      const recipes = defaultRecipeRegistry.list();
      const res: StudioResult = {
        status: "success",
        operation: "studio.recipes",
        result: recipes.map((r) => ({
          id: r.id,
          version: r.version,
          summary: r.summary,
          use_when: r.use_when,
          do_not_use_when: r.do_not_use_when,
          material_inputs: r.inputs.filter((i) => i.material).map((i) => i.key),
          affordances: r.affordances,
          capability_requirements: r.capability_requirements,
        })),
        diagnostics: { total: recipes.length },
      };
      if (isJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`\n=== Canonical Studio Recipes (${recipes.length}) ===`);
        for (const r of recipes) {
          console.log(` • ${r.id.padEnd(24)} v${r.version}`);
          console.log(`   ${r.summary}`);
        }
        console.log("");
      }
      return 0;
    }

    case "recipe": {
      const sub = filteredArgs[1];
      const parseChoices = (args: string[]): Record<string, unknown> => {
        const choices: Record<string, unknown> = {};
        for (const arg of args) {
          const eq = arg.indexOf("=");
          if (eq <= 0 || arg.startsWith("--")) continue;
          const key = arg.slice(0, eq);
          const raw = arg.slice(eq + 1);
          if (raw === "true") choices[key] = true;
          else if (raw === "false") choices[key] = false;
          else if (raw !== "" && !Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) choices[key] = Number(raw);
          else choices[key] = raw;
        }
        return choices;
      };

      const fail = (code: string, error: string, status: "failed" | "blocked" = "failed"): number => {
        const res: StudioResult = {
          status,
          operation: `studio.recipe.${sub ?? "unknown"}`,
          diagnostics: { code, error },
        };
        if (isJson) console.log(JSON.stringify(res, null, 2));
        else console.error(error);
        return status === "blocked" ? 2 : 1;
      };

      if (sub === "describe") {
        const id = filteredArgs[2];
        if (!id) return fail("RECIPE_ID_REQUIRED", "recipe describe requires a recipe id");
        const recipe = defaultRecipeRegistry.get(id);
        if (!recipe) return fail("RECIPE_NOT_FOUND", `Unknown recipe '${id}'`);
        const res: StudioResult = {
          status: "success",
          operation: "studio.recipe.describe",
          result: recipe,
          diagnostics: { recipe_id: recipe.id, version: recipe.version },
        };
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(`\n=== Recipe ${recipe.id} (v${recipe.version}) ===`);
          console.log(recipe.summary);
          console.log(`\nUse when:`);
          for (const u of recipe.use_when) console.log(`  • ${u}`);
          if (recipe.do_not_use_when.length) {
            console.log(`Do not use when:`);
            for (const u of recipe.do_not_use_when) console.log(`  • ${u}`);
          }
          console.log(`\nInputs (material choices first):`);
          const inputs = [...recipe.inputs].sort((a, b) => Number(b.material) - Number(a.material));
          if (!inputs.length) console.log(`  (none — strong defaults only)`);
          for (const i of inputs) {
            const tags = [i.required ? "required" : "optional", i.material ? "material" : "defaulted"].join(", ");
            console.log(`  • ${i.key} (${i.type}, ${tags}) — ${i.summary}`);
            if (i.default !== undefined && i.default !== "") console.log(`      default: ${JSON.stringify(i.default)}`);
            if (i.enum_values) console.log(`      values: ${i.enum_values.join(" | ")}`);
          }
          console.log(`\nAffordances: ${recipe.affordances.join(", ")}`);
          console.log(`Capability requirements: ${recipe.capability_requirements.join(", ")}`);
          console.log(`Acceptance:`);
          for (const a of recipe.acceptance) console.log(`  • ${a}`);
          console.log("");
        }
        return 0;
      }

      if (sub === "plan" || sub === "apply") {
        const id = filteredArgs[2];
        if (!id) return fail("RECIPE_ID_REQUIRED", `recipe ${sub} requires a recipe id`);
        const recipe = defaultRecipeRegistry.get(id);
        if (!recipe) return fail("RECIPE_NOT_FOUND", `Unknown recipe '${id}'`);
        const projectFlag = flagValue(filteredArgs, "--project");
        const projectRoot = path.resolve(projectFlag ?? process.cwd());
        const choices = parseChoices(filteredArgs.slice(3));

        let plan;
        try {
          plan = compileRecipe(recipe, { choices });
        } catch (err) {
          if (err instanceof RecipeCompileError) {
            return fail(err.code, err.message, err.code === "REQUIRED_INPUT_MISSING" ? "blocked" : "failed");
          }
          const msg = err instanceof Error ? err.message : String(err);
          return fail("RECIPE_COMPILE_FAILED", msg);
        }

        if (sub === "plan") {
          const res: StudioResult = {
            status: "success",
            operation: "studio.recipe.plan",
            result: plan,
            diagnostics: {
              recipe_id: recipe.id,
              steps: plan.steps.length,
              affordances: plan.affordance_graph.nodes.length,
              project_root: projectRoot,
              mutation: false,
            },
          };
          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            console.log(`\n=== Dry-run plan for ${recipe.id} (no mutation) ===`);
            console.log(`Choices: ${JSON.stringify(plan.choices)}`);
            console.log(`Affordance graph: ${plan.affordance_graph.nodes.length} nodes, ${plan.affordance_graph.edges.length} edges`);
            for (const step of plan.steps) {
              const deps = step.depends_on.length ? ` (after: ${step.depends_on.join(", ")})` : "";
              console.log(` [${step.status.padEnd(16)}] ${step.kind.padEnd(9)} ${step.id}${deps}`);
              console.log(`   ${step.summary}`);
            }
            console.log("");
          }
          return 0;
        }

        // apply
        try {
          const outcome = await applyRecipe(recipe, plan, { projectRoot });
          const res: StudioResult = {
            status: outcome.status === "success" ? "success" : outcome.status === "degraded" ? "degraded" : outcome.status,
            operation: "studio.recipe.apply",
            result: {
              provenance: outcome.provenance,
              provenance_path: outcome.provenancePath,
              structured_failure: outcome.structured_failure,
            },
            diagnostics: {
              recipe_id: recipe.id,
              steps: outcome.provenance.steps.length,
              result: outcome.status,
              project_root: projectRoot,
            },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else if (outcome.status === "success") {
            console.log(`Applied recipe ${recipe.id}; provenance appended to ${outcome.provenancePath}`);
          } else {
            const sf = outcome.structured_failure;
            console.error(
              `Recipe ${recipe.id} ${outcome.status}: affordance=${sf?.failed_affordance ?? "unknown"} ` +
                `capability=${sf?.causal_capability ?? "n/a"} retryable=${sf?.retryable ?? false} ` +
                `user_input_required=${sf?.user_input_required ?? false}`
            );
            if (sf) for (const r of sf.recovery_actions) console.error(`  recovery: ${r}`);
          }
          if (outcome.status === "success") return 0;
          if (outcome.status === "blocked") return 2;
          return 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return fail("RECIPE_APPLY_FAILED", msg);
        }
      }

      return fail("UNKNOWN_RECIPE_SUBCOMMAND", `Unknown recipe subcommand '${sub ?? ""}'. Use describe|plan|apply.`);
    }

    case "capability": {
      const sub = filteredArgs[1];
      if (sub === "prepare") {
        try {
          const firstArg = filteredArgs[2];
          let rawRequest: unknown;
          let referenceEvidenceFor: Array<Record<string, unknown>> | undefined;
          let handoffOverride: AgentHandoff | undefined;
          if (firstArg && defaultCapabilityRegistry.has(firstArg)) {
            // T15 (REQ-BIND-005) file form: capability prepare <capability-id> <request-file>
            const requestFile = filteredArgs[3];
            if (!requestFile) {
              throw new Error(`File-based preparation requires a request file path after capability id '${firstArg}'`);
            }
            const request = validateCapabilityRequest(loadCapabilityFile(requestFile));
            if (request.capability_id !== firstArg) {
              throw new Error(
                `Request file capability_id '${request.capability_id}' does not match requested capability '${firstArg}'`
              );
            }
            // TEETH-T15-001 boundary: specific depicted-object reconstruction never travels the
            // world-composition route; the director rejects and redirects to reference reconstruction.
            if (firstArg === WORLD_ENVIRONMENT_COMPOSE_CAPABILITY) {
              assertWorldCompositionIntentBoundary(request.intent);
            }
            // T14 (REQ-BIND-006, REQ-ASSET-001, REQ-ASSET-002): the reference-image reconstruction
            // route REQUIRES suitable reference imagery. Preparation blocks/asks for an allowed
            // reference instead of silently becoming generic text-to-3D, and on success normalizes
            // the AgentHandoff against the pinned vendor skill content.
            let referenceEvidence: Array<Record<string, unknown>> | undefined;
            let normalizedHandoff: AgentHandoff | undefined;
            if (firstArg === ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY) {
              const capability = defaultCapabilityRegistry.get(firstArg);
              if (!capability) throw new Error(`Capability '${firstArg}' is not registered`);
              const prep = prepareReferenceImageReconstruction(request, capability, {
                projectRoot: projectRootForFile(requestFile),
                repoRoot: repoRootForFile(requestFile),
              });
              if (prep.status === "blocked") {
                const res: StudioResult = {
                  status: "blocked",
                  operation: "studio.capability.prepare",
                  result: {
                    capability_id: prep.capability_id,
                    provider: prep.provider,
                    code: prep.code,
                    message: prep.message,
                    details: prep.details ?? [],
                    allowed_next_steps: prep.allowed_next_steps,
                    route_preserved: firstArg,
                    degraded_to_generic_text_to_3d: false,
                  },
                  diagnostics: {
                    blocked: true,
                    code: prep.code,
                    note: "Preparation blocks and asks for an allowed reference; the request never silently becomes generic text-to-3D.",
                  },
                };
                if (isJson) console.log(JSON.stringify(res, null, 2));
                else {
                  console.error(`Blocked (${prep.code}): ${prep.message}`);
                  for (const d of prep.details ?? []) console.error(`  - ${d}`);
                }
                return 1;
              }
              referenceEvidence = prep.references.map((r) => ({
                id: r.id,
                path: r.recorded_path,
                sha256: r.sha256,
                bytes: r.bytes,
                provenance_class: r.provenance_class,
                license: r.license,
                reference_only: r.reference_only,
              }));
              normalizedHandoff = prep.handoff;
            }
            // T18 (REQ-BIND-011, REQ-BLENDER-001/002/005/007): the Blender DCC
            // escalation route validates its rationale, committed source
            // definition, DCC metadata authority boundary, and Blender
            // preflight BEFORE any execution. Missing Blender is a typed,
            // SCOPED blockage of regeneration only (REQ-BLENDER-007).
            if (firstArg === DCC_BLENDER_PROCESS_CAPABILITY) {
              const capability = defaultCapabilityRegistry.get(firstArg);
              if (!capability) throw new Error(`Capability '${firstArg}' is not registered`);
              const prep = await prepareBlenderProcess(request, capability, {
                projectRoot: projectRootForFile(requestFile),
                repoRoot: repoRootForFile(requestFile),
              });
              if (prep.status === "blocked") {
                const res: StudioResult = {
                  status: "blocked",
                  operation: "studio.capability.prepare",
                  result: {
                    capability_id: prep.capability_id,
                    provider: prep.provider,
                    code: prep.code,
                    message: prep.message,
                    details: prep.details ?? [],
                    allowed_next_steps: prep.allowed_next_steps,
                    route_preserved: firstArg,
                    scoped_to_regeneration: true,
                    committed_derivatives_still_consumable: true,
                  },
                  diagnostics: {
                    blocked: true,
                    code: prep.code,
                    note: "Blender is an offline DCC escalation capability; absence blocks only this regeneration/proof route (REQ-BLENDER-007).",
                  },
                };
                if (isJson) console.log(JSON.stringify(res, null, 2));
                else {
                  console.error(`Blocked (${prep.code}): ${prep.message}`);
                  for (const d of prep.details ?? []) console.error(`  - ${d}`);
                  for (const s of prep.allowed_next_steps) console.error(`  next: ${s}`);
                }
                return 1;
              }
              const res: StudioResult = {
                status: "success",
                operation: "studio.capability.prepare",
                result: {
                  capability_id: prep.capability_id,
                  provider: prep.provider,
                  blender: prep.blender,
                  plan: prep.plan,
                  rationale: "validated before execution (REQ-BLENDER-002)",
                },
                diagnostics: {
                  deterministic: true,
                  invocation_form: prep.plan.invocation_form,
                },
              };
              if (isJson) console.log(JSON.stringify(res, null, 2));
              else console.log(`Prepared ${prep.capability_id} via ${prep.provider}: blender ${prep.blender.version}`);
              return 0;
            }
            rawRequest = request;
            referenceEvidenceFor = referenceEvidence;
            handoffOverride = normalizedHandoff;
          } else {
            rawRequest = firstArg ? JSON.parse(firstArg) : {};
          }
          const resolution = routeCapability(rawRequest as CapabilityRequest);
          const enrichedResolution = {
            ...resolution,
            ...(handoffOverride ? { handoff: handoffOverride } : {}),
            ...(referenceEvidenceFor ? { references: referenceEvidenceFor } : {}),
          };
          const res: StudioResult = {
            status: "success",
            operation: "studio.capability.prepare",
            result: enrichedResolution,
            diagnostics: {
              is_agent_handoff: resolution.is_agent_handoff,
              ...(referenceEvidenceFor ? { reference_imagery_validated: true, reference_count: referenceEvidenceFor.length } : {}),
            },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.log(`Routed to capability ${resolution.capability.id} via provider ${resolution.provider}`);
          return 0;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const res: StudioResult = {
            status: "failed",
            operation: "studio.capability.prepare",
            diagnostics: { error: msg },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(`Error: ${msg}`);
          return 1;
        }
      } else if (sub === "accept") {
        try {
          // T14 file form: capability accept <handoff.json> <artifacts.json> [provider]
          // Settling a handoff requires real accepted artifacts; a handoff alone
          // never reports capability success (PrematureSettlementError otherwise).
          const handoffArg = filteredArgs[2] || "{}";
          const handoffPath = path.resolve(process.cwd(), handoffArg);
          let handoff: AgentHandoff;
          let artifacts: ArtifactRef[];
          if (handoffArg.endsWith(".json") && fs.existsSync(handoffPath) && fs.statSync(handoffPath).isFile()) {
            handoff = JSON.parse(fs.readFileSync(handoffPath, "utf-8"));
            const artifactsArg = filteredArgs[3];
            if (!artifactsArg) throw new Error("File-form accept requires an artifacts JSON file after the handoff file");
            const artifactsPath = path.resolve(process.cwd(), artifactsArg);
            artifacts = JSON.parse(fs.readFileSync(artifactsPath, "utf-8"));
            if (!Array.isArray(artifacts)) throw new Error("Artifacts file must contain a JSON array");
          } else {
            handoff = JSON.parse(handoffArg);
            artifacts = JSON.parse(filteredArgs[3] || "[]");
          }
          const provider = filteredArgs[4] || `agent-skill.${handoff.skill_id}`;
          const capabilityResult = settleAgentHandoff(handoff, provider, artifacts);
          const res: StudioResult = {
            status: "success",
            operation: "studio.capability.accept",
            result: capabilityResult,
            diagnostics: { accepted_artifacts: artifacts.length },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.log(`Accepted handoff for request ${handoff.request_id} with ${artifacts.length} artifacts`);
          return 0;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const res: StudioResult = {
            status: "failed",
            operation: "studio.capability.accept",
            diagnostics: { error: msg },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(`Error: ${msg}`);
          return 1;
        }
      } else if (sub === "verify-result") {
        try {
          const firstArg = filteredArgs[2];
          if (firstArg && defaultCapabilityRegistry.has(firstArg)) {
            // T15 (REQ-BIND-005) file form: capability verify-result <capability-id> <result-file>
            // Capability-specific DETERMINISTIC verification — no model credentials, no network.
            const resultFile = filteredArgs[3];
            if (!resultFile) {
              throw new Error(`File-based result verification requires a result file path after capability id '${firstArg}'`);
            }
            if (firstArg === WORLD_ENVIRONMENT_COMPOSE_CAPABILITY) {
              const report = verifyWorldCompositionResultFile(resultFile);
              const res: StudioResult = {
                status: report.valid ? "success" : "failed",
                operation: "studio.capability.verify-result",
                result: report,
                diagnostics: {
                  verified: report.valid,
                  capability: firstArg,
                  result_file: resultFile,
                  checks_passed: report.summary.passed,
                  checks_failed: report.summary.failed,
                },
              };
              if (isJson) {
                console.log(JSON.stringify(res, null, 2));
              } else {
                console.log(`\n=== World Composition Result Verification (${firstArg}) ===`);
                for (const c of report.checks) {
                  console.log(` ${c.pass ? "✓" : "✗"} [${c.code}] ${c.detail}`);
                }
                console.log(`Status: ${report.valid ? "VALID" : "INVALID"}\n`);
              }
              return report.valid ? 0 : 1;
            }
            if (firstArg === ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY) {
              // T14 (REQ-BIND-006, REQ-ASSET-001/002/004): deterministic offline verification of the
              // committed accepted output — zero model invocation, zero network access, no regeneration.
              const resultPath = path.resolve(process.cwd(), resultFile);
              const outcome = await verifyImg2ThreeJsResult(loadCapabilityFile(resultFile), {
                resultPath,
                projectRoot: projectRootForFile(resultFile),
                repoRoot: repoRootForFile(resultFile),
                capabilityId: firstArg,
              });
              const res: StudioResult = {
                status: outcome.ok ? "success" : "failed",
                operation: "studio.capability.verify-result",
                result: outcome,
                diagnostics: {
                  verified: outcome.ok,
                  capability: firstArg,
                  result_file: resultFile,
                  deterministic: true,
                  model_invocation: "none",
                  network_access: "none",
                  failed_checks: outcome.checks.filter((c) => c.status === "fail").map((c) => c.id),
                },
              };
              if (isJson) {
                console.log(JSON.stringify(res, null, 2));
              } else {
                console.log(`\n=== Reference Reconstruction Result Verification (${firstArg}) ===`);
                for (const c of outcome.checks) {
                  console.log(` ${c.status === "pass" ? "✓" : "✗"} [${c.id}] ${c.detail}`);
                }
                console.log(`Status: ${outcome.ok ? "VALID" : "INVALID"}\n`);
              }
              return outcome.ok ? 0 : 1;
            }
            if (firstArg === DCC_BLENDER_PROCESS_CAPABILITY) {
              // T18 (REQ-BIND-011, REQ-BLENDER-004/006/007): deterministic offline
              // verification of the committed accepted derivative — GLB validity,
              // hashes, provenance, regeneration metadata, DCC authority boundary.
              // Zero Blender invocation, zero network, zero model credentials.
              const resultPath = path.resolve(process.cwd(), resultFile);
              const outcome = await verifyBlenderProcessResult(loadCapabilityFile(resultFile), {
                resultPath,
                projectRoot: projectRootForFile(resultFile),
                repoRoot: repoRootForFile(resultFile),
                capabilityId: firstArg,
              });
              const res: StudioResult = {
                status: outcome.ok ? "success" : "failed",
                operation: "studio.capability.verify-result",
                result: outcome,
                diagnostics: {
                  verified: outcome.ok,
                  capability: firstArg,
                  result_file: resultFile,
                  deterministic: true,
                  blender_invocation: "none",
                  network_access: "none",
                  failed_checks: outcome.checks.filter((c) => c.status === "fail").map((c) => c.id),
                },
              };
              if (isJson) {
                console.log(JSON.stringify(res, null, 2));
              } else {
                console.log(`\n=== Blender DCC Derivative Result Verification (${firstArg}) ===`);
                for (const c of outcome.checks) {
                  console.log(` ${c.status === "pass" ? "✓" : "✗"} [${c.id}] ${c.detail}`);
                }
                console.log(`Status: ${outcome.ok ? "VALID" : "INVALID"}\n`);
              }
              return outcome.ok ? 0 : 1;
            }
            throw new Error(
              `Deterministic result verification for capability '${firstArg}' is not settled by the active plan DAG yet`
            );
          }
          const raw = JSON.parse(firstArg || "{}");
          const verified = validateCapabilityResult(raw);
          const res: StudioResult = {
            status: "success",
            operation: "studio.capability.verify-result",
            result: verified,
            diagnostics: { verified: true, id: verified.id },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.log(`Result ${verified.id} satisfies studio contracts.`);
          return 0;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const res: StudioResult = {
            status: "failed",
            operation: "studio.capability.verify-result",
            diagnostics: { error: msg },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(`Error: ${msg}`);
          return 1;
        }
      } else {
        const res: StudioResult = {
          status: "failed",
          operation: "studio.capability",
          diagnostics: { error: `Unknown capability action: ${sub}` },
        };
        if (isJson) console.log(JSON.stringify(res, null, 2));
        else console.error(`Unknown capability action: ${sub}`);
        return 1;
      }
    }

    case "asset": {
      const sub = filteredArgs[1];
      if (sub === "source") {
        const provider = filteredArgs[2];
        const assetId = filteredArgs[3];
        const role = flagValue(filteredArgs, "--role");
        const projectFlag = flagValue(filteredArgs, "--project");
        const projectRoot = path.resolve(projectFlag ?? process.cwd());

        if (provider !== "polyhaven") {
          const res: StudioResult = {
            status: "failed",
            operation: "studio.asset.source",
            diagnostics: { code: "UNSUPPORTED_PROVIDER", error: "asset source supports only the registered provider 'polyhaven'" },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(res.diagnostics.error);
          return 1;
        }
        if (!assetId || !/^[a-z0-9][a-z0-9_-]*$/.test(assetId)) {
          const res: StudioResult = {
            status: "failed",
            operation: "studio.asset.source",
            diagnostics: { code: "ASSET_ID_INVALID", error: "asset source requires a normalized Poly Haven asset id" },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(res.diagnostics.error);
          return 1;
        }
        if (!role || role.trim().length === 0) {
          const res: StudioResult = {
            status: "failed",
            operation: "studio.asset.source",
            diagnostics: { code: "ROLE_REQUIRED", error: "asset source requires --role <role>" },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(res.diagnostics.error);
          return 1;
        }

        let registry: AssetRegistry;
        try {
          registry = new AssetRegistry(projectRoot);
          registry.load();
          const recordId = `polyhaven-${assetId}`;
          if (registry.get(recordId) || registry.isReferenceOnly(recordId)) {
            const res: StudioResult = {
              status: "failed",
              operation: "studio.asset.source",
              diagnostics: { code: "ASSET_ALREADY_REGISTERED", error: `Asset '${recordId}' is already registered; source intake will not overwrite retained bytes` },
            };
            if (isJson) console.log(JSON.stringify(res, null, 2));
            else console.error(res.diagnostics.error);
            return 1;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const res: StudioResult = { status: "failed", operation: "studio.asset.source", diagnostics: { code: "REGISTRY_UNAVAILABLE", error: msg } };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(`Error: ${msg}`);
          return 1;
        }

        const intake = await new PolyHavenAssetSource().intakeAsset(assetId, { role, projectRoot });
        if (intake.status === "blocked") {
          const res: StudioResult = {
            status: "blocked",
            operation: "studio.asset.source",
            diagnostics: { code: intake.code, error: intake.detail, provider, asset_id: assetId },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(`Blocked (${intake.code}): ${intake.detail}`);
          return 2;
        }
        if (intake.status === "failed") {
          const res: StudioResult = {
            status: "failed",
            operation: "studio.asset.source",
            diagnostics: { code: intake.code, error: intake.detail, provider, asset_id: assetId },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(`Error (${intake.code}): ${intake.detail}`);
          return 1;
        }

        try {
          const registered = registry.intake(intake.data.asset_record);
          registry.save();
          const res: StudioResult = {
            status: "success",
            operation: "studio.asset.source",
            result: { asset_record: registered.record, files: intake.data.files },
            diagnostics: {
              provider,
              project_root: projectRoot,
              manifest_path: registry.manifestPath,
              acceptance_state: registered.state,
              provenance_violations: registered.provenance_violations,
            },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.log(`Sourced ${registered.record.id} as ${registered.state}.`);
          return 0;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const res: StudioResult = { status: "failed", operation: "studio.asset.source", diagnostics: { code: "REGISTRY_INTAKE_FAILED", error: msg } };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(`Error: ${msg}`);
          return 1;
        }
      }

      if (sub === "resolve") {
        // T26 (REQ-ASSET-008..012): first-class asset.resolve routing.
        // Policy: search/acquire, then adapt, then create; creation is only ever a
        // recorded fallback decision, and acquisition flows through the settled
        // asset.source intake (Poly Haven adapter) into the AssetRegistry as a
        // pending record. Providers are replaceable adapters below this contract.
        const requestedId = filteredArgs[2];
        const role = flagValue(filteredArgs, "--role");
        const keywordsFlag = flagValue(filteredArgs, "--keywords");
        const requireLicense = flagValue(filteredArgs, "--require-license");
        const maxTrianglesFlag = flagValue(filteredArgs, "--max-triangles");
        const projectFlag = flagValue(filteredArgs, "--project");
        const projectRoot = path.resolve(projectFlag ?? process.cwd());

        const rejectRequest = (code: string, error: string): number => {
          const res: StudioResult = { status: "failed", operation: "studio.asset.resolve", diagnostics: { code, error } };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(error);
          return 1;
        };
        if (!requestedId || !/^[a-z0-9][a-z0-9_-]*$/.test(requestedId)) return rejectRequest("REQUESTED_ID_INVALID", "asset resolve requires a normalized requested id");
        if (!role || role.trim().length === 0) return rejectRequest("ROLE_REQUIRED", "asset resolve requires --role <role>");
        const keywords = (keywordsFlag ?? requestedId).split(",").map(k => k.trim()).filter(k => k.length > 0);
        if (keywords.length === 0) return rejectRequest("KEYWORDS_REQUIRED", "asset resolve requires --keywords <a,b,c> or a usable requested id");

        const polyhavenProvider: AssetSourceProvider = {
          id: "polyhaven",
          async search(kws, r) {
            // Keyword search spans the whole catalog: a role hint only orders it.
            const preferred: Array<"models" | "textures" | "hdris"> = /texture|material/i.test(r) ? ["textures", "models", "hdris"] : /hdri|skybox/i.test(r) ? ["hdris", "models", "textures"] : ["models", "textures", "hdris"];
            const source = new PolyHavenAssetSource();
            const needles = kws.map(k => k.toLowerCase());
            const lists = await Promise.all(preferred.map(type => source.listAssets(type)));
            const unavailable = lists.find(l => l.status !== "success");
            if (unavailable && lists.every(l => l.status !== "success")) return { status: "unavailable", detail: `${unavailable.code}: ${unavailable.detail}` };
            const matches = lists.flatMap(l => l.status === "success" ? l.data : [])
              .filter(a => needles.some(n => a.id.toLowerCase().includes(n) || a.name.toLowerCase().includes(n)))
              .slice(0, 5)
              .map(a => ({ provider: "polyhaven", assetId: a.id, title: a.name, license: null, sourceUri: `https://polyhaven.com/a/${a.id}`, metadata: { polycount: a.polycount } }));
            return { status: "success", matches };
          },
          async acquire(m, r, root) {
            const intake = await new PolyHavenAssetSource().intakeAsset(m.assetId, { role: r, projectRoot: root });
            if (intake.status === "success") return { status: "success", assetRecord: intake.data.asset_record as Record<string, unknown>, files: intake.data.files.map(f => f.path) };
            return { status: intake.status, code: intake.code, detail: intake.detail };
          },
        };

        const resolver = new AssetResolver({ providers: [polyhavenProvider] });
        const outcome = await resolver.resolve({
          requestedId,
          role,
          keywords,
          projectRoot,
          ...(requireLicense ? { requireLicense } : {}),
          ...(maxTrianglesFlag ? { maxTriangles: Number(maxTrianglesFlag) } : {}),
        });
        if (isJson) console.log(JSON.stringify(outcome, null, 2));
        else if (outcome.status === "success") console.log(`Resolved '${requestedId}' via ${outcome.result.route}${outcome.result.provider ? ` (${outcome.result.provider}/${outcome.result.asset_id})` : ""}. Decision: ${outcome.result.decision_file}`);
        else console.error(`${outcome.status.toUpperCase()} (${outcome.diagnostics.code}): ${outcome.diagnostics.error}${outcome.status === "blocked" && "decision_file" in outcome.result ? ` | Decision: ${outcome.result.decision_file}` : ""}`);
        if (outcome.status === "success") return 0;
        if (outcome.status === "blocked") return 2;
        return 1;
      }

      if (sub === "verify") {
        // T13 (REQ-OUT-002, REQ-ASSET-006, REQ-ASSET-007, REQ-SAFE-003, REQ-SEC-004):
        // release/asset check over the project-local Asset Registry.
        const allFlag = filteredArgs.includes("--all");
        const projectIdx = filteredArgs.indexOf("--project");
        const explicitProject = projectIdx >= 0 && typeof filteredArgs[projectIdx + 1] === "string";
        const projectRoot = explicitProject ? path.resolve(filteredArgs[projectIdx + 1]) : process.cwd();

        if (!allFlag) {
          const res: StudioResult = {
            status: "blocked",
            operation: "studio.asset.verify",
            diagnostics: {
              message: "Only 'asset verify --all' is settled by T13; per-asset verification is governed by later plan tasks.",
              unlocked_in: "T14/T15/T18",
            },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.log("'asset verify' requires --all (per-asset verification is pending plan settlement).");
          return 0;
        }

        try {
          const registry = new AssetRegistry(projectRoot);
          if (!registry.exists()) {
            if (explicitProject) {
              const res: StudioResult = {
                status: "blocked",
                operation: "studio.asset.verify",
                diagnostics: {
                  code: "MANIFEST_MISSING",
                  error: `No asset registry found at ${registry.manifestPath}`,
                },
              };
              if (isJson) console.log(JSON.stringify(res, null, 2));
              else console.error(`Blocked: no asset registry found at ${registry.manifestPath}`);
              return 2;
            }
            const res: StudioResult = {
              status: "success",
              operation: "studio.asset.verify",
              result: {
                totals: { total: 0, accepted: 0, degraded: 0, pending: 0, rejected: 0, blocked: 0, not_acceptable: 0 },
                assets: [],
              },
              diagnostics: {
                note: "No asset registry found in this project; 0 assets verified (vacuous pass).",
                manifest_path: registry.manifestPath,
              },
            };
            if (isJson) console.log(JSON.stringify(res, null, 2));
            else console.log(`No asset registry at ${registry.manifestPath}; 0 assets verified.`);
            return 0;
          }

          registry.load();
          const report = registry.verifyAll();
          const res: StudioResult = {
            status: report.status,
            operation: "studio.asset.verify",
            result: report,
            diagnostics: {
              project_root: projectRoot,
              manifest_path: report.manifest_path,
              total: report.totals.total,
              not_acceptable: report.totals.not_acceptable,
            },
          };
          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            console.log(`\n=== Asset Registry Verify (${projectRoot}) ===`);
            console.log(`Manifest: ${report.manifest_path}`);
            const t = report.totals;
            console.log(`Assets: ${t.total} (accepted ${t.accepted}, degraded ${t.degraded}, pending ${t.pending}, rejected ${t.rejected}, blocked ${t.blocked})`);
            for (const asset of report.assets) {
              const mark = asset.production_acceptable ? (asset.acceptance_state === "degraded" ? "⚠" : "✓") : "✗";
              const suffix = asset.clean_pending ? " (clean pending)" : asset.blockers.length > 0 ? ` — ${asset.blockers.map((b) => b.gate).join(", ")}` : "";
              console.log(` ${mark} ${asset.asset_id} [${asset.acceptance_state}] ${asset.role} (${asset.origin})${suffix}`);
            }
            console.log(`Status: ${report.status.toUpperCase()}\n`);
          }
          return report.status === "success" ? 0 : 1;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const res: StudioResult = {
            status: "failed",
            operation: "studio.asset.verify",
            diagnostics: { error: msg },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(`Error: ${msg}`);
          return 1;
        }
      }

      const res: StudioResult = {
        status: "blocked",
        operation: `studio.asset.${sub ?? "default"}`,
        diagnostics: {
          message: `Asset action '${sub}' is governed by future task settlement in the active plan DAG.`,
          unlocked_in: "T14/T15/T18",
        },
      };
      if (isJson) console.log(JSON.stringify(res, null, 2));
      else console.log(`Asset action '${sub}' is pending plan settlement.`);
      return 0;
    }

    case "observe": {
      // T20 (REQ-BIND-010, REQ-OUT-003): deterministic Playwright observation via the
      // stable __GAUNTLET_STUDIO_OBS__ v1 methods, stored as immutable evidence.
      // Observation only — no expectation interpretation happens here.
      const scenarioId = filteredArgs[1] || "fixture-ok";
      const outDir = flagValue(filteredArgs, "--out");
      const revisionFlag = flagValue(filteredArgs, "--revision");
      const profileFlag = flagValue(filteredArgs, "--profile");
      if (profileFlag) {
        // Declared-before-use validation: an undeclared profile can never be observed
        // under (REQ-PERF-002); numbers come from the game project (REQ-CONFIG-005).
        bindQualityProfile(loadQualityProfiles(gameSpecOrDefault(flagValue(filteredArgs, "--game-spec"))), profileFlag);
      }
      try {
        const rev = revisionOrBlocked("studio.observe", revisionFlag);
        if (rev.blocked) {
          if (isJson) console.log(JSON.stringify(rev.blocked, null, 2));
          else console.error(`Blocked (${rev.blocked.diagnostics.code}): ${rev.blocked.diagnostics.error}`);
          return 2;
        }
        let scenario;
        try {
          scenario = buildFixtureScenario(scenarioId);
        } catch {
          throw new Error(
            `unknown scenario '${scenarioId}'; deterministic fixture scenarios: fixture-ok, fixture-wrong-state ` +
              `(real-title scenario routing settles with later plan tasks)`
          );
        }
        const store = new EvidenceStore({
          projectRoot: process.cwd(),
          ...(outDir ? { runsRoot: path.resolve(outDir) } : {}),
        });
        const observed = await runScenario({
          scenario,
          projectRevision: rev.revision!,
          requirementIds: ["REQ-OUT-003", "REQ-GOAL-004"],
          sink: store.createRunWriter(),
          headless: !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
          timeoutMs: 45000,
          ...(profileFlag ? { qualityProfile: profileFlag } : {}),
        });
        const runDir = observed.run_dir ?? (observed.run ? store.runDir(observed.run.id) : undefined);
        const payload = {
          status: observed.status,
          scenario_id: scenarioId,
          project_revision: rev.revision,
          run_id: observed.run?.id,
          manifest_id: observed.manifest?.id,
          manifest_result: observed.manifest?.result,
          channels: observed.channels.map((c) => c.channel),
          artifacts: observed.manifest?.artifacts.map((a) => ({ path: a.path, sha256: a.sha256, role: a.role })),
          run_dir: runDir,
          blockage: observed.blockage,
        };
        const res: StudioResult =
          observed.status === "observed"
            ? {
                status: "success",
                operation: "studio.observe",
                result: payload,
                diagnostics: {
                  observation_only: true,
                  note: "Observation is not interpretation; settle expectations via 'studio verify'.",
                },
              }
            : {
                status: "blocked",
                operation: "studio.observe",
                result: payload,
                diagnostics: { code: observed.blockage?.code, error: observed.blockage?.message },
              };
        if (isJson) console.log(JSON.stringify(res, null, 2));
        else if (observed.status === "observed") {
          console.log(`Observed ${scenarioId} as run ${observed.run?.id} (${observed.run_dir})`);
          console.log(`Channels: ${observed.channels.map((c) => c.channel).join(", ")}`);
        } else {
          console.error(`Blocked (${observed.blockage?.code}): ${observed.blockage?.message}`);
        }
        return observed.status === "observed" ? 0 : 2;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const res: StudioResult = {
          status: "failed",
          operation: "studio.observe",
          diagnostics: { error: msg },
        };
        if (isJson) console.log(JSON.stringify(res, null, 2));
        else console.error(`Error: ${msg}`);
        return 1;
      }
    }

    case "verify": {
      // T20 (REQ-GAUNTLET-001..006, REQ-VERIFY-001/002/005): fresh observation vs the
      // FROZEN expectation -> append-only SettlementRecord. T21 (REQ-VERIFY-003,
      // REQ-PERF-001..004) adds the scenario/profile form: performance claims settle
      // ONLY against the game-project-declared quality profile. T22 adds the SUITE form:
      // verify --project <dir> --suite <name> runs a game project's committed named-
      // scenario suite (fresh ObservationRun + EvidenceManifest + SettlementRecord per
      // scenario). Exit codes: 0 settled, 1 failed, 2 blocked/incomplete — a blockage
      // can never read as a pass.
      const suiteFlag = flagValue(filteredArgs, "--suite");
      const projectFlag = flagValue(filteredArgs, "--project");
      if (suiteFlag) {
        try {
          if (!projectFlag) {
            throw new Error("usage: studio verify --suite <name|all> requires --project <game-project-dir>");
          }
          const projectRoot = path.resolve(process.cwd(), projectFlag);
          // T25: `--suite all` runs every game-declared suite (teeth-* falsification
          // fixtures excluded) with fresh evidence per scenario; same exit semantics.
          const result =
            suiteFlag === "all"
              ? await runGameSuiteAll(projectRoot)
              : await runGameSuiteVerify(projectRoot, suiteFlag);
          const payload = result.result as SuiteVerifyPayload & {
            suites?: string[];
            results?: SuiteVerifyPayload[];
          };
          if (isJson) console.log(JSON.stringify(result, null, 2));
          else if (suiteFlag === "all") {
            const total = payload.totals.settled + payload.totals.failed + payload.totals.blocked + payload.totals.incomplete;
            console.log(`Suites [${(payload.suites ?? []).join(", ")}] @ ${projectRoot}: ${payload.totals.settled}/${total} settled`);
            for (const s of payload.results ?? []) {
              console.log(`  suite '${s.suite}':`);
              for (const sc of s.scenarios) {
                console.log(`    ${sc.scenario}: ${sc.decision.toUpperCase()}${sc.reason ? ` — ${sc.reason}` : ""}`);
              }
            }
          } else {
            const total = payload.totals.settled + payload.totals.failed + payload.totals.blocked + payload.totals.incomplete;
            console.log(`Suite '${suiteFlag}' @ ${projectRoot}: ${payload.totals.settled}/${total} settled`);
            for (const s of payload.scenarios) {
              console.log(`  ${s.scenario}: ${s.decision.toUpperCase()}${s.reason ? ` — ${s.reason}` : ""}`);
            }
          }
          return result.status === "success" ? 0 : result.status === "failed" ? 1 : 2;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const res: StudioResult = {
            status: "failed",
            operation: suiteFlag === "all" ? "studio.verify-suite-all" : "studio.verify-suite",
            diagnostics: { error: msg },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(`Error: ${msg}`);
          return 1;
        }
      }
      const scenarioFlag = flagValue(filteredArgs, "--scenario");
      const profileFlag = flagValue(filteredArgs, "--profile");
      const gameSpecFlag = flagValue(filteredArgs, "--game-spec");
      const idOrPath = filteredArgs[1];
      const revisionFlag = flagValue(filteredArgs, "--revision");
      try {
        let expectation: FrozenExpectation;
        if (scenarioFlag) {
          // T21 form: verify --scenario <id> --profile <declared-profile-id>.
          // The frozen expectation is committed under the scenario id BEFORE evidence.
          expectation = loadFrozenExpectation(scenarioFlag);
          if (expectation.scenario_id !== scenarioFlag) {
            throw new Error(
              `frozen expectation '${expectation.id}' binds scenario '${expectation.scenario_id}', not '${scenarioFlag}'`
            );
          }
          if (profileFlag && expectation.performance && expectation.performance.profile !== profileFlag) {
            throw new Error(
              `quality profile '${profileFlag}' does not match the profile declared by frozen expectation ` +
                `'${expectation.id}' ('${expectation.performance.profile}'); profiles bind before evidence evaluation`
            );
          }
        } else {
          if (!idOrPath) {
            throw new Error(
              "usage: studio verify <expectation-id-or-json-path> | studio verify --scenario <id> --profile <profile-id>"
            );
          }
          expectation = loadFrozenExpectation(idOrPath);
        }
        const rev = revisionOrBlocked("studio.verify", revisionFlag);
        if (rev.blocked) {
          if (isJson) console.log(JSON.stringify(rev.blocked, null, 2));
          else console.error(`Blocked (${rev.blocked.diagnostics.code}): ${rev.blocked.diagnostics.error}`);
          return 2;
        }
        // Resolve the DECLARED quality profile from the game project BEFORE evidence
        // evaluation (REQ-PERF-002: declared before use as gates; REQ-CONFIG-005:
        // numbers live in the game project).
        const perfResolution = expectation.performance
          ? resolvePerformanceProfile(expectation, gameSpecFlag ?? REFERENCE_GAME_SPEC)
          : null;
        let assetSummary: AssetBudgetSummary | null = null;
        if (perfResolution) {
          const registry = new AssetRegistry(process.cwd());
          if (registry.exists()) {
            registry.load();
            assetSummary = { not_acceptable: registry.verifyAll().totals.not_acceptable };
          }
        }
        const scenario = buildFixtureScenario(expectation.scenario_id, {
          seed: expectation.seed,
          steps: expectation.steps,
          view: expectation.view,
        });
        const store = new EvidenceStore({ projectRoot: process.cwd() });
        const observed = await runScenario({
          scenario,
          projectRevision: rev.revision!,
          requirementIds: [...expectation.requirement_ids],
          sink: store.createRunWriter(),
          headless: !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
          timeoutMs: 45000,
          ...(expectation.performance ? { qualityProfile: expectation.performance.profile } : {}),
        });
        const outcome = settleObserved(expectation, observed, rev.revision!, undefined, perfResolution ? { profile: perfResolution.profile, asset_summary: assetSummary } : null);
        let settlementPath: string | undefined;
        if (outcome.record && observed.run) {
          store.appendSettlement(observed.run.id, outcome.record);
          settlementPath = path.join(store.runDir(observed.run.id), "settlement-01.json");
        }
        const res: StudioResult = {
          status:
            outcome.decision === "settled" ? "success" : outcome.decision === "failed" ? "failed" : "blocked",
          operation: "studio.verify",
          result: {
            expectation_id: expectation.id,
            scenario_id: expectation.scenario_id,
            ...(expectation.performance ? { quality_profile: expectation.performance.profile } : {}),
            ...(perfResolution ? { game_spec: perfResolution.game_spec } : {}),
            decision: outcome.decision,
            blockage_class: outcome.blockage_class,
            reason: outcome.reason,
            contradictions: outcome.contradictions,
            ...(outcome.budget_error ? { budget_error: outcome.budget_error } : {}),
            requirement_ids: expectation.requirement_ids,
            run_id: observed.run?.id,
            run_dir: observed.run_dir ?? (observed.run ? store.runDir(observed.run.id) : undefined),
            settlement_path: settlementPath,
            channel_verdicts: outcome.channel_verdicts.map((v) => ({
              channel: v.channel,
              evaluated: v.evaluated,
              pass: v.pass,
              failed_checks: v.checks.filter((c) => !c.pass),
            })),
          },
          diagnostics: {
            fresh_observation: true,
            settlement_append_only: true,
            exit_code_semantics: "0=settled 1=failed 2=blocked/incomplete",
          },
        };
        if (isJson) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(`Expectation ${expectation.id}: ${outcome.decision.toUpperCase()}`);
          if (expectation.performance) console.log(`Quality profile: ${expectation.performance.profile}`);
          if (outcome.blockage_class) console.log(`Blockage: ${outcome.blockage_class}`);
          console.log(`Reason: ${outcome.reason}`);
          for (const c of outcome.contradictions) console.log(`Contradiction: ${c}`);
          if (settlementPath) console.log(`Settlement appended: ${settlementPath}`);
        }
        return outcome.decision === "settled" ? 0 : outcome.decision === "failed" ? 1 : 2;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const res: StudioResult = {
          status: "failed",
          operation: "studio.verify",
          diagnostics: { error: msg },
        };
        if (isJson) console.log(JSON.stringify(res, null, 2));
        else console.error(`Error: ${msg}`);
        return 1;
      }
    }

    case "evidence": {
      const sub = filteredArgs[1];
      if (sub === "check-fixtures") {
        // T20 gate: validate committed evidence fixtures — schema enforcement,
        // run/manifest correlation, artifact hash re-verification, and negative
        // controls that MUST reject (stale revision etc.).
        try {
          const fixturesFlag = flagValue(filteredArgs, "--fixtures");
          const fixturesRoot = path.resolve(fixturesFlag ?? PROOF_FIXTURES_DIR);
          const store = new EvidenceStore({ projectRoot: process.cwd() });
          const report = store.checkFixtures(fixturesRoot);
          const res: StudioResult = {
            status: report.status === "success" ? "success" : "failed",
            operation: "studio.evidence.check-fixtures",
            result: report,
            diagnostics: {
              fixtures_root: fixturesRoot,
              total: report.totals.total,
              passed: report.totals.passed,
              failed: report.totals.failed,
            },
          };
          if (isJson) {
            console.log(JSON.stringify(res, null, 2));
          } else {
            console.log(`\n=== Evidence Fixture Check (${fixturesRoot}) ===`);
            for (const f of report.fixtures) {
              console.log(` ${f.status === "invalid" ? "✗" : "✓"} ${f.fixture} [${f.status}]`);
              for (const c of f.checks) {
                if (!c.pass) console.log(`   FAIL ${c.code}: ${c.detail}`);
              }
            }
            console.log(`Status: ${report.status.toUpperCase()}\n`);
          }
          return report.status === "success" ? 0 : 1;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const res: StudioResult = {
            status: "failed",
            operation: "studio.evidence.check-fixtures",
            diagnostics: { error: msg },
          };
          if (isJson) console.log(JSON.stringify(res, null, 2));
          else console.error(`Error: ${msg}`);
          return 1;
        }
      }
      const res: StudioResult = {
        status: "blocked",
        operation: `studio.evidence.${sub ?? "default"}`,
        diagnostics: {
          message: `Evidence action '${sub}' is governed by future task settlement in the active plan DAG.`,
          settled_in: "T20 (check-fixtures)",
        },
      };
      if (isJson) console.log(JSON.stringify(res, null, 2));
      else console.log(`Evidence action '${sub}' is pending plan settlement.`);
      return 0;
    }

    default: {
      const res: StudioResult = {
        status: "failed",
        operation: "studio",
        diagnostics: { error: `Unknown command: ${command}` },
      };
      if (isJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.error(`Unknown command: ${command}`);
        printHelp();
      }
      return 1;
    }
  }
}

if (import.meta.main) {
  main().then((code) => {
    if (code !== 0) process.exit(code);
  });
}
