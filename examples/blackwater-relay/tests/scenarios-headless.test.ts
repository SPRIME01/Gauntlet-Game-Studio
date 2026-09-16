import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import * as path from "node:path";

/**
 * Thin wrapper (T22): runs the headless scenario progression checks in a CHILD process.
 * Koota caps worlds per process (16); isolating the game boots here keeps the studio's
 * root `bun test` process within budget while still gating every scenario deterministically.
 */

describe("Blackwater Relay headless scenario progression (T22, child-process isolated)", () => {
  it("completes all headless scenario checks", () => {
    const projectRoot = path.resolve(import.meta.dir, "..");
    const out = execSync("bun run ./tests/scenarios-headless.run.ts", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "inherit"],
      timeout: 300_000,
    });
    expect(out).toContain("HEADLESS_SCENARIO_CHECKS_OK");
  }, 320_000);
});
