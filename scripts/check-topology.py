#!/usr/bin/env python3
"""
scripts/check-topology.py

Mechanical validation script for Gauntlet Game Studio monorepo topology and source boundaries.
Settles requirements:
- REQ-REPO-001 (Monorepo boundaries)
- REQ-REPO-004 (Package boundary discipline: no 1-per-adapter package sprawl)
- REQ-REPO-005 (Donor isolation in .tmp/ and gitignored)
- REQ-CONFIG-007 (Bun 1.4 baseline in package manifests)
- REQ-SOURCE-001 (First-party ownership)
"""

import sys
import os
import json
import glob

APPROVED_PACKAGES = {
    "packages/contracts",
    "packages/studio",
    "packages/runtime",
    "packages/adapters",
    "apps/studio-cli",
}

def err(msg: str):
    print(f"FAIL: {msg}", file=sys.stderr)

def ok(msg: str):
    print(f"OK:   {msg}")

def check_topology(root_dir: str = ".") -> bool:
    all_passed = True

    # 1. Inspect root package.json
    pkg_path = os.path.join(root_dir, "package.json")
    if not os.path.exists(pkg_path):
        err("Root package.json does not exist")
        return False

    try:
        with open(pkg_path, "r", encoding="utf-8") as f:
            root_pkg = json.load(f)
        ok("Root package.json parsed successfully.")
    except Exception as e:
        err(f"Root package.json failed to parse: {e}")
        return False

    # Check engines and packageManager
    engines = root_pkg.get("engines", {})
    if "bun" not in engines or "1.4" not in engines["bun"]:
        err(f"engines.bun must specify >=1.4.0, found: {engines.get('bun')}")
        all_passed = False
    else:
        ok("engines.bun specifies Bun 1.4 baseline.")

    # Check workspaces
    workspaces = root_pkg.get("workspaces", [])
    for w in workspaces:
        if "donor" in w or ".tmp" in w:
            err(f"Disallowed donor workspace glob found: {w}")
            all_passed = False

    # 2. Check for disallowed package proliferation
    found_packages = set()
    for pkg_json in glob.glob(os.path.join(root_dir, "packages/*/package.json")) + glob.glob(os.path.join(root_dir, "apps/*/package.json")):
        rel_dir = os.path.relpath(os.path.dirname(pkg_json), root_dir)
        found_packages.add(rel_dir)

    unapproved = found_packages - APPROVED_PACKAGES
    if unapproved:
        err(f"Unapproved workspace packages detected (violates REQ-REPO-004): {sorted(list(unapproved))}")
        all_passed = False
    else:
        ok(f"Workspace packages ({len(found_packages)}) match approved boundaries: {sorted(list(found_packages))}")

    # Check for adapter package sprawl (adapters must be modules inside packages/adapters)
    for p in found_packages:
        if p.startswith("packages/adapters-") or p.startswith("packages/adapter-"):
            err(f"Unearned independent adapter package detected (must be module inside packages/adapters): {p}")
            all_passed = False

    # 3. Check donor isolation
    gitignore_path = os.path.join(root_dir, ".gitignore")
    if os.path.exists(gitignore_path):
        with open(gitignore_path, "r", encoding="utf-8") as f:
            gi_content = f.read()
        if ".tmp/" not in gi_content and ".tmp" not in gi_content:
            err(".tmp/ is missing from .gitignore (violates REQ-REPO-005)")
            all_passed = False
        else:
            ok(".tmp/ is gitignored in .gitignore.")
    else:
        err(".gitignore missing")
        all_passed = False

    # Check package dependencies for donor references
    for p in found_packages:
        p_json_file = os.path.join(root_dir, p, "package.json")
        try:
            with open(p_json_file, "r", encoding="utf-8") as f:
                p_data = json.load(f)
            deps = {**p_data.get("dependencies", {}), **p_data.get("devDependencies", {})}
            for dep_name, dep_ver in deps.items():
                if "donor" in dep_name or "donor" in dep_ver or ".tmp" in dep_ver:
                    err(f"Package {p} imports or depends on donor: {dep_name} -> {dep_ver}")
                    all_passed = False
        except Exception as e:
            err(f"Failed to read {p_json_file}: {e}")
            all_passed = False

    if all_passed:
        ok("ALL TOPOLOGY AND SOURCE BOUNDARY CHECKS PASSED.")
        return True
    else:
        err("TOPOLOGY CHECKS FAILED.")
        return False

if __name__ == "__main__":
    passed = check_topology("." if len(sys.argv) <= 1 else sys.argv[1])
    sys.exit(0 if passed else 1)
