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
  buildFixtureScenario,
  runScenario,
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
      // ONLY against the game-project-declared quality profile. Exit codes: 0 settled,
      // 1 failed, 2 blocked/incomplete — a blockage can never read as a pass.
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
