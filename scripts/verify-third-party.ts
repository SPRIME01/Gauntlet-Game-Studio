#!/usr/bin/env bun
import * as path from "node:path";
import * as fs from "node:fs";
import { validateOverlayPolicy } from "../packages/studio/src/skills/overlay";

console.log("=== Gauntlet Studio Third-Party Attribution & Overlay Verifier (REQ-SOURCE-005, REQ-SOURCE-006) ===");

const rootDir = path.resolve(__dirname, "..");
const overlayPath = path.join(rootDir, "vendor/skills/threejs-game-skills/overlay.json");
const attributionPath = path.join(rootDir, "vendor/attribution.json");
const noticesPath = path.join(rootDir, "THIRD_PARTY_NOTICES.md");

let hasErrors = false;

// 1. Overlay policy check
if (fs.existsSync(overlayPath)) {
  const overlay = JSON.parse(fs.readFileSync(overlayPath, "utf-8"));
  const policyResult = validateOverlayPolicy(overlay);
  if (!policyResult.valid) {
    console.error("FAIL: Overlay policy validation failed:");
    for (const err of policyResult.errors) {
      console.error(`  - ${err}`);
    }
    hasErrors = true;
  } else {
    console.log("OK: Overlay policy verified (threejs-game-director strictly forbidden).");
  }
} else {
  console.error(`FAIL: Missing ${overlayPath}`);
  hasErrors = true;
}

// 2. Attribution classes check
if (fs.existsSync(attributionPath)) {
  const attr = JSON.parse(fs.readFileSync(attributionPath, "utf-8"));
  const requiredClasses = [
    "runtime_dependency",
    "agent_skill_source",
    "temporary_donor",
    "copied_code",
    "external_asset",
  ];
  for (const cls of requiredClasses) {
    if (!attr.classes || !attr.classes[cls]) {
      console.error(`FAIL: Attribution manifest missing class '${cls}'`);
      hasErrors = true;
    }
  }
  if (!hasErrors) {
    console.log("OK: All 5 attribution classes present in vendor/attribution.json.");
  }
} else {
  console.error(`FAIL: Missing ${attributionPath}`);
  hasErrors = true;
}

// 3. Notices check
if (fs.existsSync(noticesPath)) {
  const content = fs.readFileSync(noticesPath, "utf-8");
  if (!content.includes("runtime_dependency") || !content.includes("threejs-game-director")) {
    console.error("FAIL: THIRD_PARTY_NOTICES.md is missing required provenance details.");
    hasErrors = true;
  } else {
    console.log("OK: THIRD_PARTY_NOTICES.md verified.");
  }
} else {
  console.error(`FAIL: Missing ${noticesPath}`);
  hasErrors = true;
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log("SUCCESS: All third-party attribution and overlay policies verified.");
  process.exit(0);
}
