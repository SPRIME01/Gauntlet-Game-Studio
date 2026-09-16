/**
 * Blackwater Relay — single-player suite runner (T22).
 *
 * Runs the frozen named-scenario suite (.agents/suites/single-player.yaml) against the
 * BUILT game served over loopback, drives every scenario ONLY through the stable
 * __GAUNTLET_STUDIO_OBS__ v1 methods (via the T20 Playwright harness), and settles each
 * frozen expectation through the studio Gauntlet bridge. Observation is separated from
 * interpretation: the harness observes; @gauntlet/studio settles.
 *
 * Suite result semantics mirror the studio CLI: exit/settled only when every scenario
 * decision is "settled"; failed/blocked/incomplete never read as a pass.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runScenario, type ScenarioRunResult } from "@gauntlet/adapters";
import {
  AssetRegistry,
  EvidenceStore,
  bindQualityProfile,
  loadQualityProfiles,
  parseFrozenExpectation,
  resolveProjectRevision,
  settleExpectation,
  type ChannelVerdict,
  type FrozenExpectation,
  type ResolvedQualityProfile,
  type SettlementOutcome,
} from "@gauntlet/studio";
import { serveGame, type ServedGame } from "./serve";

export interface SuiteEntryResult {
  scenario: string;
  decision: "settled" | "blocked" | "failed" | "incomplete";
  blockage_class?: string;
  reason: string;
  observation_status: "observed" | "blocked";
  observation_blockage?: string;
  channel_verdicts: Array<{ channel: string; evaluated: boolean; pass: boolean; failed_checks: string[] }>;
  run_id?: string;
}

export interface SuiteResult {
  suite: string;
  project_root: string;
  project_revision: string;
  game_spec: string;
  scenarios: SuiteEntryResult[];
  totals: { settled: number; failed: number; blocked: number; incomplete: number };
  all_settled: boolean;
}

export interface SuiteManifestEntry {
  scenario: string;
  file: string;
}

export interface SuiteManifest {
  suite: string;
  expectations: SuiteManifestEntry[];
}

export function loadSuiteManifest(projectRoot: string, suiteName: string): SuiteManifest {
  const manifestPath = path.join(projectRoot, ".agents", "suites", `${suiteName}.yaml`);
  const raw = Bun.YAML.parse(fs.readFileSync(manifestPath, "utf-8")) as SuiteManifest;
  if (!raw || raw.suite !== suiteName || !Array.isArray(raw.expectations) || raw.expectations.length === 0) {
    throw new Error(`suite manifest '${manifestPath}' is missing its expectations list`);
  }
  return raw;
}

/** Loads one frozen expectation committed under the game project. */
export function loadProjectExpectation(projectRoot: string, relFile: string): FrozenExpectation {
  const file = path.resolve(projectRoot, relFile);
  return parseFrozenExpectation(JSON.parse(fs.readFileSync(file, "utf-8")));
}

/** Asset-registry summary for performance settlement (same shape as the CLI path). */
function assetSummary(projectRoot: string): { not_acceptable: number } | null {
  const registry = new AssetRegistry(projectRoot);
  if (!registry.exists()) return null;
  registry.load();
  return { not_acceptable: registry.verifyAll().totals.not_acceptable };
}

export interface RunSuiteOptions {
  projectRoot: string;
  suiteName?: string;
  /** Persist canonical evidence + settlement records under the project store. */
  evidence?: boolean;
  headless?: boolean;
  timeoutMs?: number;
  /** Extra URL query params (fixture variants, observability mode). */
  query?: string;
}

export async function runSinglePlayerSuite(options: RunSuiteOptions): Promise<SuiteResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const suiteName = options.suiteName ?? "single-player";
  const manifest = loadSuiteManifest(projectRoot, suiteName);
  const revision = resolveProjectRevision(projectRoot);
  const gameSpec = path.join(projectRoot, ".agents", "specs", "game.spec.yaml");
  const profiles = loadQualityProfiles(gameSpec);

  const store = options.evidence === false ? null : new EvidenceStore({ projectRoot });
  const summary = assetSummary(projectRoot);

  let served: ServedGame | null = null;
  const entries: SuiteEntryResult[] = [];

  try {
    served = serveGame(projectRoot);
    const base = options.query ? `${served.url}/?${options.query}` : `${served.url}/`;

    for (const entry of manifest.expectations) {
      const expectation = loadProjectExpectation(projectRoot, entry.file);
      if (expectation.scenario_id !== entry.scenario) {
        throw new Error(
          `suite entry '${entry.scenario}' binds expectation '${expectation.id}' for scenario '${expectation.scenario_id}'`
        );
      }

      const perfResolution: { profile: ResolvedQualityProfile } | null = expectation.performance
        ? { profile: bindQualityProfile(profiles, expectation.performance.profile) }
        : null;

      let observed: ScenarioRunResult;
      try {
        observed = await runScenario({
          scenario: { id: entry.scenario, url: base, seed: expectation.seed, steps: expectation.steps, view: expectation.view },
          projectRevision: revision,
          requirementIds: [...expectation.requirement_ids],
          ...(store ? { sink: store.createRunWriter() } : {}),
          headless: options.headless ?? true,
          timeoutMs: options.timeoutMs ?? 90000,
          ...(expectation.performance ? { qualityProfile: expectation.performance.profile } : {}),
        });
      } catch (err) {
        observed = {
          status: "blocked",
          blockage: { code: "SCENARIO_ERROR", message: err instanceof Error ? err.message : String(err) },
          channels: [],
        };
      }

      const channels = observed.channels ?? [];
      const outcome: SettlementOutcome = settleExpectation({
        expectation,
        run: observed.run ? (JSON.parse(JSON.stringify(observed.run)) as never) : null,
        manifests: observed.manifest ? [JSON.parse(JSON.stringify(observed.manifest)) as never] : [],
        channels,
        availability: {
          browser_proof_available: observed.status === "observed",
          unavailable_reason: observed.blockage?.message,
        },
        currentRevision: revision,
        performance: perfResolution ? { profile: perfResolution.profile, asset_summary: summary } : null,
      });

      if (store && observed.run && outcome.record) {
        store.appendSettlement(observed.run.id, outcome.record);
      }

      entries.push({
        scenario: entry.scenario,
        decision: outcome.decision,
        ...(outcome.blockage_class ? { blockage_class: outcome.blockage_class } : {}),
        reason: outcome.reason,
        observation_status: observed.status,
        ...(observed.blockage ? { observation_blockage: `${observed.blockage.code}: ${observed.blockage.message}` } : {}),
        channel_verdicts: outcome.channel_verdicts.map((v: ChannelVerdict) => ({
          channel: v.channel,
          evaluated: v.evaluated,
          pass: v.pass,
          failed_checks: v.checks.filter((c) => !c.pass).map((c) => `${c.code}: ${c.detail}`),
        })),
        ...(observed.run ? { run_id: observed.run.id } : {}),
      });
    }
  } finally {
    served?.stop();
  }

  const totals = {
    settled: entries.filter((e) => e.decision === "settled").length,
    failed: entries.filter((e) => e.decision === "failed").length,
    blocked: entries.filter((e) => e.decision === "blocked").length,
    incomplete: entries.filter((e) => e.decision === "incomplete").length,
  };

  return {
    suite: suiteName,
    project_root: projectRoot,
    project_revision: revision,
    game_spec: gameSpec,
    scenarios: entries,
    totals,
    all_settled: totals.settled === entries.length,
  };
}
