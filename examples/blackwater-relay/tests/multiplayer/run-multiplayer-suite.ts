/**
 * Blackwater Relay — multiplayer suite runner (T23).
 *
 * Runs the frozen networked-scenario suite (.agents/suites/multiplayer.yaml): per
 * scenario it spawns the authoritative headless server, connects TWO independent
 * browser clients through the game-owned observer (tests/multiplayer/observer.ts),
 * and settles each frozen expectation through the studio Gauntlet bridge with a fresh
 * ObservationRun + EvidenceManifest + SettlementRecord in the project evidence store.
 *
 * Suite result semantics mirror the studio CLI: settled only when every scenario
 * decision is "settled"; failed/blocked/incomplete never read as a pass.
 */

import * as path from "node:path";
import {
  EvidenceStore,
  parseFrozenExpectation,
  resolveProjectRevision,
  settleExpectation,
  type ChannelVerdict,
  type FrozenExpectation,
  type SettlementOutcome,
} from "@gauntlet/studio";
import type { ScenarioRunResult } from "@gauntlet/adapters";
import { serveGame, type ServedGame } from "../e2e/serve";
import { loadProjectExpectation, loadSuiteManifest, type SuiteManifest } from "../e2e/run-suite";
import { observeScenario } from "./observer";

export interface MultiplayerEntryResult {
  scenario: string;
  decision: "settled" | "blocked" | "failed" | "incomplete";
  blockage_class?: string;
  reason: string;
  observation_status: "observed" | "blocked";
  observation_blockage?: string;
  channel_verdicts: Array<{ channel: string; evaluated: boolean; pass: boolean; failed_checks: string[] }>;
  run_id?: string;
}

export interface MultiplayerSuiteResult {
  suite: string;
  project_root: string;
  project_revision: string;
  game_spec: string;
  scenarios: MultiplayerEntryResult[];
  totals: { settled: number; failed: number; blocked: number; incomplete: number };
  all_settled: boolean;
}

export type { SuiteManifest };

export interface RunMultiplayerSuiteOptions {
  projectRoot: string;
  suiteName?: string;
  /** Persist canonical evidence + settlement records under the project store. */
  evidence?: boolean;
  headless?: boolean;
  timeoutMs?: number;
}

export async function runMultiplayerSuite(
  options: RunMultiplayerSuiteOptions
): Promise<MultiplayerSuiteResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const suiteName = options.suiteName ?? "multiplayer";
  const manifest = loadSuiteManifest(projectRoot, suiteName);
  const observation = (
    manifest as {
      observation?: { mode?: string; module?: string; export?: string; server?: { script?: string } };
    }
  ).observation;
  if (!observation || observation.mode !== "project-runner" || !observation.module) {
    throw new Error(`suite manifest '${suiteName}' does not declare a project-runner observation mode`);
  }
  const observationModule = path.resolve(projectRoot, observation.module);
  const observationExport = observation.export ?? "observeScenario";
  const serverScript = path.resolve(projectRoot, observation.server?.script ?? "src/server.ts");

  const revision = resolveProjectRevision(projectRoot);
  const gameSpec = path.join(projectRoot, ".agents", "specs", "game.spec.yaml");

  const store = options.evidence === false ? null : new EvidenceStore({ projectRoot });

  let served: ServedGame | null = null;
  const entries: MultiplayerEntryResult[] = [];

  try {
    served = serveGame(projectRoot);
    for (const entry of manifest.expectations) {
      const expectation: FrozenExpectation = loadProjectExpectation(projectRoot, entry.file);
      if (expectation.scenario_id !== entry.scenario) {
        throw new Error(
          `suite entry '${entry.scenario}' binds expectation '${expectation.id}' for scenario '${expectation.scenario_id}'`
        );
      }

      // The project-owned two-client observer replaces ONLY the single-page observation
      // step; evidence flows through the same canonical sink and settlement bridge.
      const mod = (await import(observationModule)) as Record<string, unknown>;
      const observe = mod[observationExport];
      if (typeof observe !== "function") {
        throw new Error(`observation module '${observationModule}' does not export '${observationExport}'`);
      }

      let observed: ScenarioRunResult;
      try {
        observed = await (observe as (ctx: unknown) => Promise<ScenarioRunResult>)({
          projectRoot,
          pageUrl: served.url,
          serverScript,
          scenarioId: entry.scenario,
          seed: expectation.seed,
          steps: expectation.steps,
          view: expectation.view,
          projectRevision: revision,
          requirementIds: [...expectation.requirement_ids],
          headless: options.headless ?? true,
          timeoutMs: options.timeoutMs ?? 90_000,
          ...(store ? { sink: store.createRunWriter() } : {}),
        });
      } catch (err) {
        observed = {
          status: "blocked",
          blockage: { code: "SCENARIO_ERROR", message: err instanceof Error ? err.message : String(err) },
          channels: [],
        };
      }

      const outcome: SettlementOutcome = settleExpectation({
        expectation,
        run: observed.run ? (JSON.parse(JSON.stringify(observed.run)) as never) : null,
        manifests: observed.manifest ? [JSON.parse(JSON.stringify(observed.manifest)) as never] : [],
        channels: observed.channels ?? [],
        availability: {
          browser_proof_available: observed.status === "observed",
          unavailable_reason: observed.blockage?.message,
        },
        currentRevision: revision,
        performance: null,
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
