#!/usr/bin/env bun
/**
 * TEETH-T22-002: Run normal build/test with Blender absent and `.tmp/donor/` ignored.
 *
 * Legs:
 *  A. blender is genuinely absent from the sanitized PATH.
 *  B. game unit tests pass without Blender.
 *  C. game build (typecheck + browser bundle) passes without Blender.
 *  D. the full single-player e2e suite passes without Blender — the committed accepted
 *     service-drone derivative is consumed directly (assets/service-drone.glb).
 *  E. `.tmp/donor` stays gitignored and the studio donor-dependency scan stays green.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const REPO_ROOT = path.resolve(PROJECT_ROOT, "..", "..");

// ---- Sanitize PATH: drop every directory containing a blender executable ----------
const pathSep = ":";
const dirs = (process.env.PATH ?? "").split(pathSep).filter(Boolean);
const kept: string[] = [];
const removed: string[] = [];
for (const dir of dirs) {
  try {
    if (fs.existsSync(path.join(dir, "blender"))) {
      removed.push(dir);
      continue;
    }
  } catch {
    // unreadable dir: keep
  }
  kept.push(dir);
}
const sanitizedPath = kept.join(pathSep);
const env = { ...process.env, PATH: sanitizedPath };
console.log(`sanitized PATH: removed [${removed.join(", ") || "nothing to remove"}]`);

function probeBlender(): boolean {
  const result = Bun.spawnSync(["which", "blender"], { env, stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0;
}

// ---- Leg A: blender absent under sanitized PATH ------------------------------------
if (probeBlender()) {
  console.error("TEETH-T22-002 LEG A FAILED: blender still reachable under sanitized PATH.");
  process.exit(1);
}
console.log("PASS A: blender absent from sanitized PATH");

async function leg(name: string, cmd: string[], cwd: string): Promise<void> {
  console.log(`--- ${name}: ${cmd.join(" ")} (cwd ${cwd})`);
  const proc = Bun.spawn(cmd, { cwd, env, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`TEETH-T22-002 ${name} FAILED (exit ${code}).`);
    process.exit(1);
  }
  console.log(`PASS ${name}`);
}

// ---- Legs B/C/D: tests, build, full e2e suite without Blender ----------------------
await leg("B", ["bun", "run", "test"], PROJECT_ROOT);
await leg("C", ["bun", "run", "build"], PROJECT_ROOT);
await leg("D", ["bun", "run", "test:e2e"], PROJECT_ROOT);

// ---- Leg E: donor isolation ---------------------------------------------------------
const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf-8");
if (!/\.tmp/.test(gitignore)) {
  console.error("TEETH-T22-002 LEG E FAILED: .tmp/ not gitignored at the repo root.");
  process.exit(1);
}
await leg("E", ["bun", "run", "donor:dependency-scan"], REPO_ROOT);

console.log("TEETH-T22-002 BIT: build/test/e2e green with Blender absent and .tmp/donor ignored;");
console.log("the committed accepted service-drone derivative is sufficient for all gameplay.");
