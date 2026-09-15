#!/usr/bin/env bun
/**
 * @gauntlet/studio-cli
 * Command-line interface for Gauntlet Game Studio.
 */

import { getDoctorStudioResult, runDoctor, loadStudioConfig } from "@gauntlet/studio";
import type { StudioResult } from "@gauntlet/contracts";

export const CLI_VERSION = "0.2.0";

function printHelp() {
  console.log(`
Gauntlet Game Studio Semantic CLI (v${CLI_VERSION})

Usage:
  studio <command> [options]

Commands:
  doctor                       Validate development environment and prerequisites
  config                       Inspect resolved configuration
  create <name>                Scaffold a new game project
  capabilities                 List registered studio capabilities
  capability <action>          Prepare, accept, or verify capability results
  asset <action>               Asset compiler and provenance inspection
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
        // Mask secrets
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
      const projectName = filteredArgs[1] || "new-game";
      const res: StudioResult = {
        status: "success",
        operation: "studio.create",
        result: { project_name: projectName, path: `projects/${projectName}` },
        diagnostics: { message: `Project scaffold contract prepared for ${projectName}` },
      };
      if (isJson) console.log(JSON.stringify(res, null, 2));
      else console.log(`Created project definition: ${projectName}`);
      return 0;
    }

    case "capabilities":
    case "capability":
    case "asset":
    case "observe":
    case "verify":
    case "evidence": {
      const res: StudioResult = {
        status: "blocked",
        operation: `studio.${command}`,
        diagnostics: {
          message: `Command '${command}' is governed by future task settlement in the active plan DAG.`,
          unlocked_in: command === "capabilities" || command === "capability" ? "T04" : command === "asset" ? "T13" : "T20",
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
