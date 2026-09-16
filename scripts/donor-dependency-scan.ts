#!/usr/bin/env bun
import * as path from "node:path";
import * as fs from "node:fs";

console.log("=== Gauntlet Studio Donor Dependency & White-Label Scanner (REQ-DONOR-004, REQ-DONOR-005, REQ-DONOR-007, REQ-SEC-006) ===");

const rootDir = path.resolve(__dirname, "..");
const scanDirs = ["packages", "apps", "templates"];
let violations = 0;

function scanFiles(dir: string, fileCallback: (filePath: string) => void) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".tmp" || entry.name === ".git") {
        continue;
      }
      scanFiles(fullPath, fileCallback);
    } else if (entry.isFile()) {
      fileCallback(fullPath);
    }
  }
}

// 1. Scan Source Files for Forbidden Imports
const forbiddenImportPatterns = [
  /from\s+['"][^'"]*\/donor\/[^'"]*['"]/,
  /from\s+['"][^'"]*\.tmp\/[^'"]*['"]/,
  /from\s+['"]@mavon\/[^'"]*['"]/,
  /from\s+['"]mavon-engine[^'"]*['"]/,
  /require\(['"][^'"]*\/donor\/[^'"]*['"]\)/,
  /require\(['"][^'"]*\.tmp\/[^'"]*['"]\)/,
  /require\(['"]@mavon\/[^'"]*['"]\)/,
  /require\(['"]mavon-engine[^'"]*['"]\)/,
];

console.log("1. Scanning first-party source files for forbidden donor imports...");

for (const sd of scanDirs) {
  const fullSd = path.join(rootDir, sd);
  scanFiles(fullSd, (filePath) => {
    if ((!filePath.endsWith(".ts") && !filePath.endsWith(".js") && !filePath.endsWith(".json")) || filePath.endsWith(".test.ts") || filePath.endsWith(".spec.ts")) {
      return;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    for (const pattern of forbiddenImportPatterns) {
      if (pattern.test(content)) {
        console.error(`FAIL: Forbidden donor import matched pattern ${pattern} in ${filePath}`);
        violations++;
      }
    }

    // Check for donor runtime class branding in public packages
    if (filePath.includes("packages/runtime/src") && !filePath.includes("donor-isolation.test.ts")) {
      if (/\bMavonEngine\b/.test(content) || /\bMavon\b/.test(content)) {
        console.error(`FAIL: Donor branding 'Mavon' detected in runtime source: ${filePath}`);
        violations++;
      }
    }
  });
}

// 2. Scan package.json files for forbidden dependencies
console.log("2. Scanning package manifests for donor package dependencies...");

function checkPackageJson(pkgPath: string) {
  if (!fs.existsSync(pkgPath)) return;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const depSections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

  for (const section of depSections) {
    const deps = pkg[section];
    if (deps) {
      for (const depName of Object.keys(deps)) {
        if (depName.startsWith("@mavon") || depName.includes("mavon-engine")) {
          console.error(`FAIL: Forbidden donor dependency '${depName}' declared in ${pkgPath} (${section})`);
          violations++;
        }
      }
    }
  }
}

checkPackageJson(path.join(rootDir, "package.json"));
for (const sd of ["packages", "apps"]) {
  const base = path.join(rootDir, sd);
  if (fs.existsSync(base)) {
    for (const sub of fs.readdirSync(base)) {
      checkPackageJson(path.join(base, sub, "package.json"));
    }
  }
}

// 3. Scan tsconfig files for donor path mappings
console.log("3. Scanning TypeScript configs for donor path mappings...");

function checkTsConfig(tsPath: string) {
  if (!fs.existsSync(tsPath)) return;
  const content = fs.readFileSync(tsPath, "utf-8");
  if (content.includes("donor") || content.includes(".tmp/")) {
    console.error(`FAIL: Forbidden path mapping to donor quarantine in ${tsPath}`);
    violations++;
  }
}

checkTsConfig(path.join(rootDir, "tsconfig.json"));
for (const sd of ["packages", "apps"]) {
  const base = path.join(rootDir, sd);
  if (fs.existsSync(base)) {
    for (const sub of fs.readdirSync(base)) {
      checkTsConfig(path.join(base, sub, "tsconfig.json"));
    }
  }
}

if (violations > 0) {
  console.error(`FAILED: Donor dependency scan found ${violations} violation(s).`);
  process.exit(1);
} else {
  console.log("SUCCESS: Zero forbidden donor imports, dependencies, or path mappings detected.");
  process.exit(0);
}
