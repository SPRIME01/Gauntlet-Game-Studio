#!/usr/bin/env bun
/**
 * @gauntlet/studio-cli
 * Command-line interface for Gauntlet Game Studio.
 */

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
} from "@gauntlet/studio";
import {
  validateCapabilityResult,
  type StudioResult,
  type CapabilityRequest,
  type AgentHandoff,
  type ArtifactRef,
} from "@gauntlet/contracts";

export const CLI_VERSION = "0.2.0";

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
                               Prepare, accept, or verify capability results
  asset verify --all           Verify the project Asset Registry: provenance, acceptance gates
  asset <other-action>         Asset compiler/source actions (typed placeholders until settled)
  observe <action>             Run observation scenarios
  verify <action>              Run verification against frozen expectations
  evidence <action>            Inspect or generate evidence manifests

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
          const rawRequest = filteredArgs[2] ? JSON.parse(filteredArgs[2]) : {};
          const resolution = routeCapability(rawRequest as CapabilityRequest);
          const res: StudioResult = {
            status: "success",
            operation: "studio.capability.prepare",
            result: resolution,
            diagnostics: { is_agent_handoff: resolution.is_agent_handoff },
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
          const handoff: AgentHandoff = JSON.parse(filteredArgs[2] || "{}");
          const artifacts: ArtifactRef[] = JSON.parse(filteredArgs[3] || "[]");
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
          const raw = JSON.parse(filteredArgs[2] || "{}");
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

    case "observe":
    case "verify":
    case "evidence": {
      const res: StudioResult = {
        status: "blocked",
        operation: `studio.${command}`,
        diagnostics: {
          message: `Command '${command}' is governed by future task settlement in the active plan DAG.`,
          unlocked_in: "T20",
        },
      };
      if (isJson) console.log(JSON.stringify(res, null, 2));
      else console.log(`Command '${command}' is pending plan settlement.`);
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
