#!/usr/bin/env bun
/**
 * TEETH-T18-001 gate: test:blender-absent-build (T18, REQ-BLENDER-006/007).
 *
 * Proves the normal game build/test consumes ONLY committed accepted
 * derivatives — with Blender explicitly removed from PATH (env manipulation,
 * never uninstall) and .tmp/donor ignored:
 *
 *   leg A  normal game tests (examples/blackwater-relay) — green without Blender;
 *   leg B  normal game module build (bun build of the game entry) — green;
 *   leg C  stripped-env absence contract (blender-absence.ts): typed
 *          BLENDER_UNAVAILABLE regeneration blockage + offline verify-result
 *          of the committed derivative — blockage is scoped, everything else
 *          green;
 *   leg D  donor isolation: .tmp/donor stays ignored and unimported.
 *
 * Exits 0 only when every leg holds. This script is the bound
 * `test:blender-absent-build` gate in the root package.json.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..", "..");
const projectRoot = path.join(repoRoot, "examples", "blackwater-relay");

/** Builds a PATH with every directory containing a blender executable removed. */
function strippedPath(): { env: Record<string, string>; removed: string[] } {
  const currentPath = process.env.PATH ?? "";
  const entries = currentPath.split(path.delimiter).filter((entry) => entry.length > 0);
  const removed: string[] = [];
  const kept = entries.filter((entry) => {
    try {
      if (fs.existsSync(path.join(entry, "blender"))) {
        removed.push(entry);
        return false;
      }
    } catch {
      // unreadable PATH entry: keep it, harmless for this proof
    }
    return true;
  });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.PATH = kept.join(path.delimiter);
  return { env, removed };
}

interface LegResult {
  label: string;
  ok: boolean;
  detail: string;
}

async function spawnLeg(
  label: string,
  command: string[],
  cwd: string,
  env: Record<string, string>,
  expect: { exitCode: number; stdoutIncludes?: string[] }
): Promise<LegResult> {
  const proc = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const problems: string[] = [];
  if (exitCode !== expect.exitCode) problems.push(`exit ${exitCode} != ${expect.exitCode}`);
  for (const needle of expect.stdoutIncludes ?? []) {
    if (!(stdout + stderr).includes(needle)) problems.push(`output lacks '${needle}'`);
  }
  const tail = (stdout + "\n" + stderr).trim().split("\n").slice(-6).join(" | ");
  return {
    label,
    ok: problems.length === 0,
    detail: problems.length === 0 ? tail : `${problems.join("; ")} :: ${tail}`,
  };
}

async function main(): Promise<number> {
  console.log("=== TEETH-T18-001: blender-absent build/test proof ===");
  const { env, removed } = strippedPath();
  console.log(`sanitized PATH: removed [${removed.join(", ") || "nothing — blender already absent"}]`);

  const legs: LegResult[] = [];

  // Leg A: normal game tests without Blender.
  legs.push(
    await spawnLeg("A: game tests green without Blender", ["bun", "test"], projectRoot, env, { exitCode: 0 })
  );

  // Leg B: normal game module build without Blender.
  legs.push(
    await spawnLeg(
      "B: game module build green without Blender",
      ["bun", "build", "./src/index.ts", "--target=browser", "--outfile", "/dev/null"],
      projectRoot,
      env,
      { exitCode: 0 }
    )
  );

  // Leg C: scoped absence contract (typed blockage + offline verification).
  legs.push(
    await spawnLeg(
      "C: typed BLENDER_UNAVAILABLE blockage + offline verify-result of committed derivative",
      ["bun", "run", path.join(repoRoot, "packages", "adapters", "test", "blender", "blender-absence.ts")],
      repoRoot,
      env,
      { exitCode: 0, stdoutIncludes: ["ABSENCE_CONTRACT_OK"] }
    )
  );

  // Leg D: donor isolation unchanged — reuse the repository-native donor gate
  // (settled in T09) plus the .tmp/donor gitignore condition.
  let donorOk = true;
  let donorDetail = "";
  try {
    const check = Bun.spawnSync(["git", "check-ignore", ".tmp/donor"], { cwd: repoRoot });
    donorOk = check.exitCode === 0;
    donorDetail = donorOk ? ".tmp/donor gitignored" : ".tmp/donor NOT ignored";
    const scan = Bun.spawnSync(["bun", "run", "donor:dependency-scan"], {
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const scanOk = scan.exitCode === 0;
    donorOk = donorOk && scanOk;
    donorDetail += scanOk
      ? "; donor:dependency-scan green without Blender"
      : `; donor:dependency-scan failed: ${scan.stderr.toString().slice(0, 200)}`;
  } catch (err) {
    donorOk = false;
    donorDetail = `donor check failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  legs.push({ label: "D: .tmp/donor ignored and unimported", ok: donorOk, detail: donorDetail });

  let ok = true;
  for (const leg of legs) {
    console.log(` ${leg.ok ? "PASS" : "FAIL"} ${leg.label}`);
    if (!leg.ok) {
      ok = false;
      console.log(`      ${leg.detail}`);
    }
  }
  console.log(ok ? "BLENDER_ABSENT_BUILD_OK" : "BLENDER_ABSENT_BUILD_FAILED");
  return ok ? 0 : 1;
}

main().then((code) => {
  if (code !== 0) process.exit(code);
});
