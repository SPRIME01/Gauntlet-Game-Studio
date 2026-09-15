#!/usr/bin/env bun
import * as path from "node:path";
import * as fs from "node:fs";
import { lintSourceAttribution, verifySingleThreeVersion } from "../packages/studio/src/skills/overlay";

console.log("=== Gauntlet Studio Source Integration Verifier (REQ-SOURCE-001, REQ-SOURCE-005) ===");

const rootDir = path.resolve(__dirname, "..");
const vendorDir = path.join(rootDir, "vendor");
const attributionPath = path.join(vendorDir, "attribution.json");

let hasErrors = false;

// 1. Source attribution linting
if (fs.existsSync(attributionPath)) {
  const attribution = JSON.parse(fs.readFileSync(attributionPath, "utf-8"));
  const lintResult = lintSourceAttribution(vendorDir, attribution);
  if (!lintResult.valid) {
    console.error("FAIL: Source attribution lint failed:");
    for (const err of lintResult.errors) {
      console.error(`  - ${err}`);
    }
    hasErrors = true;
  } else {
    console.log("OK: Source attribution lint passed (no unnecessary vendoring).");
  }
} else {
  console.error(`FAIL: Missing ${attributionPath}`);
  hasErrors = true;
}

// 2. Single Three.js dependency resolution across monorepo and templates
const packageJsonFiles = [
  path.join(rootDir, "templates/game/package.json"),
  path.join(rootDir, "examples/blackwater-relay/package.json"),
  path.join(rootDir, "packages/runtime/package.json"),
];

const threeResult = verifySingleThreeVersion(packageJsonFiles);
if (!threeResult.uniform) {
  console.error("FAIL: Inconsistent Three.js versions detected:");
  for (const [pkg, ver] of Object.entries(threeResult.mismatched)) {
    console.error(`  - ${pkg}: ${ver}`);
  }
  hasErrors = true;
} else {
  console.log(`OK: Authoritative single Three.js dependency verified (${threeResult.version}).`);
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log("SUCCESS: All source integration constraints verified.");
  process.exit(0);
}
