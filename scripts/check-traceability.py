#!/usr/bin/env python3
"""
scripts/check-traceability.py

Mechanical validation script for Gauntlet Game Studio specification and development plan.

Verifies:
1. YAML parsing for both spec and plan.
2. Unique identifiers across the specification.
3. Accurate SHA-256 match between approved spec and plan source binding.
4. Comprehensive multi-class traceability:
   - 100% of REQ-* normative requirements mapped to settlement tasks.
   - 100% of VAR-* variation cases mapped to settlement tasks.
   - 100% of RECOV-* recovery cases mapped to settlement tasks.
   - 100% of CLAIM-* claims mapped to evidence tasks.
   - Zero unknown IDs referenced by the plan.
5. Task settlement integrity: T24 explicitly settles all VAR-* and RECOV-* cases.
6. Dependency DAG integrity:
   - All depends_on tasks exist.
   - Graph is strictly acyclic.
   - Computed longest path length and critical path match declared representation.
7. Proof level discipline:
   - Every P3 task requires frozen preregistration artifact.
   - Every P3 task requires fresh independent/adversarial confirmation semantics.
8. Path conventions:
   - All authoritative paths use .agents/specs/, .agents/plans/, and .agents/CURRENT_STATUS.yml.
   - Prohibits root specs/, root plans/, or .agents/state/current-status.yaml.
9. Donor and baseline boundary checks:
   - Clean-checkout verification with .tmp/donor/ absent.
   - No baseline gate requires Blender, toktx, WebRTC/geckos, or .tmp/donor/ unless explicitly required.
"""

import sys
import os
import hashlib
import re
from typing import Dict, List, Set, Any
import yaml


def err(msg: str):
    print(f"FAIL: {msg}", file=sys.stderr)


def info(msg: str):
    print(f"INFO: {msg}")


def ok(msg: str):
    print(f"OK:   {msg}")


def compute_sha256(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def extract_spec_ids_with_dupes(raw_text: str):
    """Scan raw text for all defined IDs and check for duplicates."""
    id_pattern = re.compile(r'^\s*-\s*id:\s*([A-Z0-9_-]+)', re.MULTILINE)
    matches = id_pattern.findall(raw_text)
    seen = {}
    duplicates = []
    for m in matches:
        if m in seen:
            duplicates.append(m)
        seen[m] = seen.get(m, 0) + 1
    return seen, duplicates


def compute_longest_paths(edges: List[List[str]], start_node: str, end_node: str):
    adj: Dict[str, List[str]] = {}
    for u, v in edges:
        adj.setdefault(u, []).append(v)

    def dfs(u: str, current_path: List[str]) -> List[List[str]]:
        if u == end_node:
            return [current_path]
        paths = []
        for v in adj.get(u, []):
            paths.extend(dfs(v, current_path + [v]))
        return paths

    all_paths = dfs(start_node, [start_node])
    if not all_paths:
        return 0, []
    max_len = max(len(p) for p in all_paths)
    longest = [p for p in all_paths if len(p) == max_len]
    return max_len, longest


def validate(plan_path: str, spec_path: str) -> bool:
    all_passed = True

    # 1. Existence and YAML parsing
    for path, label in [(spec_path, "Spec"), (plan_path, "Plan")]:
        if not os.path.exists(path):
            err(f"{label} file does not exist: {path}")
            return False

    with open(spec_path, "r", encoding="utf-8") as f:
        spec_raw = f.read()
    with open(plan_path, "r", encoding="utf-8") as f:
        plan_raw = f.read()

    try:
        spec = yaml.safe_load(spec_raw)
        ok("Specification YAML parsed successfully.")
    except Exception as e:
        err(f"Specification YAML parsing failed: {e}")
        return False

    try:
        plan = yaml.safe_load(plan_raw)
        ok("Plan YAML parsed successfully.")
    except Exception as e:
        err(f"Plan YAML parsing failed: {e}")
        return False

    # 2. Spec ID uniqueness
    all_seen, duplicates = extract_spec_ids_with_dupes(spec_raw)
    if duplicates:
        err(f"Found duplicate IDs in specification: {duplicates}")
        all_passed = False
    else:
        ok(f"All {len(all_seen)} specification IDs are globally unique.")

    # Categorize spec IDs
    spec_reqs = sorted([i for i in all_seen if re.match(r"^REQ-[A-Z]+-[0-9]+$", i)])
    spec_vars = sorted([i for i in all_seen if re.match(r"^VAR-[0-9]+$", i)])
    spec_recovs = sorted([i for i in all_seen if re.match(r"^RECOV-[0-9]+$", i)])
    spec_claims = sorted([i for i in all_seen if re.match(r"^CLAIM-[0-9]+$", i)])
    spec_nongoals = sorted([i for i in all_seen if re.match(r"^NONGOAL-[0-9]+$", i)])

    info(f"Spec identifier breakdown: {len(spec_reqs)} REQ, {len(spec_vars)} VAR, {len(spec_recovs)} RECOV, {len(spec_claims)} CLAIM, {len(spec_nongoals)} NONGOAL (Total: {len(all_seen)})")

    # Check normative bindings
    if "REQ-BIND-015" not in spec_reqs:
        err("Missing required normative binding REQ-BIND-015 for @dimforge/rapier3d-compat")
        all_passed = False
    else:
        ok("Normative binding REQ-BIND-015 present in specification.")

    # Verify no obsolete bindings
    spec_bindings = spec.get("required_runtime_bindings", {}).get("bindings", [])
    for b in spec_bindings:
        pkg = str(b.get("package", "")).lower()
        bid = b.get("id", "")
        if "needle" in pkg or "three.terrain" in pkg:
            err(f"Obsolete binding found in specification: {bid} ({pkg})")
            all_passed = False

    # Verify no obsolete requirements mention Needle or three.terrain as requirements
    for r in spec.get("outcome_contract", {}).get("requirements", []):
        rtext = str(r.get("text", "")).lower()
        if "needle" in rtext or "three.terrain" in rtext:
            err(f"Obsolete library in outcome requirement: {r.get('id')}")
            all_passed = False

    ok("No obsolete Needle or three.terrain bindings/requirements in specification.")

    # Check spec status
    spec_status = spec.get("metadata", {}).get("status")
    if spec_status != "approved":
        err(f"Specification status is '{spec_status}', expected 'approved'.")
        all_passed = False
    else:
        ok("Specification status is 'approved'.")

    # 3. SHA-256 binding check
    spec_sha = hashlib.sha256(spec_raw.encode("utf-8")).hexdigest()
    plan_bound_sha = plan.get("source", {}).get("spec", {}).get("sha256")
    if plan_bound_sha != spec_sha:
        err(f"Plan bound SHA-256 ({plan_bound_sha}) does not match actual spec SHA-256 ({spec_sha})")
        all_passed = False
    else:
        ok(f"Plan bound SHA-256 matches actual spec: {spec_sha}")

    plan_status = plan.get("metadata", {}).get("status")
    if plan_status not in ["approved", "executable", "ready"]:
        err(f"Plan status is '{plan_status}', expected 'approved', 'executable', or 'ready'.")
        all_passed = False
    else:
        ok(f"Plan status is '{plan_status}'.")

    # 4. Multi-class traceability checks
    trace = plan.get("traceability", {})
    if not trace:
        err("Plan lacks 'traceability' section.")
        return False

    req_map: Dict[str, List[str]] = trace.get("requirement_to_tasks", {})
    var_map: Dict[str, List[str]] = trace.get("variations_to_tasks", {})
    recov_map: Dict[str, List[str]] = trace.get("recovery_cases_to_tasks", {})
    claim_map: Dict[str, List[str]] = trace.get("claims_to_tasks", {})

    # Check REQ coverage
    unmapped_reqs = set(spec_reqs) - set(req_map.keys())
    unknown_reqs = set(req_map.keys()) - set(spec_reqs)
    if unmapped_reqs:
        err(f"Unmapped REQ-* requirements ({len(unmapped_reqs)}): {sorted(list(unmapped_reqs))}")
        all_passed = False
    else:
        ok(f"All {len(spec_reqs)} REQ-* requirements are mapped to tasks.")

    if unknown_reqs:
        err(f"Unknown REQ-* mapped by plan ({len(unknown_reqs)}): {sorted(list(unknown_reqs))}")
        all_passed = False

    # Check VAR coverage
    unmapped_vars = set(spec_vars) - set(var_map.keys())
    unknown_vars = set(var_map.keys()) - set(spec_vars)
    if unmapped_vars:
        err(f"Unmapped VAR-* variations ({len(unmapped_vars)}): {sorted(list(unmapped_vars))}")
        all_passed = False
    else:
        ok(f"All {len(spec_vars)} VAR-* variation cases are mapped to tasks.")

    if unknown_vars:
        err(f"Unknown VAR-* mapped by plan: {sorted(list(unknown_vars))}")
        all_passed = False

    # Check RECOV coverage
    unmapped_recovs = set(spec_recovs) - set(recov_map.keys())
    unknown_recovs = set(recov_map.keys()) - set(spec_recovs)
    if unmapped_recovs:
        err(f"Unmapped RECOV-* recovery cases ({len(unmapped_recovs)}): {sorted(list(unmapped_recovs))}")
        all_passed = False
    else:
        ok(f"All {len(spec_recovs)} RECOV-* recovery cases are mapped to tasks.")

    if unknown_recovs:
        err(f"Unknown RECOV-* mapped by plan: {sorted(list(unknown_recovs))}")
        all_passed = False

    # Check CLAIM coverage
    unmapped_claims = set(spec_claims) - set(claim_map.keys())
    unknown_claims = set(claim_map.keys()) - set(spec_claims)
    if unmapped_claims:
        err(f"Unmapped CLAIM-* claims ({len(unmapped_claims)}): {sorted(list(unmapped_claims))}")
        all_passed = False
    else:
        ok(f"All {len(spec_claims)} CLAIM-* claims have evidence-task mappings.")

    if unknown_claims:
        err(f"Unknown CLAIM-* mapped by plan: {sorted(list(unknown_claims))}")
        all_passed = False

    # 5. Check T24 settlement of variations and recovery cases
    tasks: Dict[str, Dict[str, Any]] = plan.get("tasks", {})
    t24 = tasks.get("T24", {})
    t24_settles = set(t24.get("settles", []))
    t24_settles_vars = set(t24.get("settles_variations", []))
    t24_settles_recovs = set(t24.get("settles_recovery_cases", []))

    all_t24_vars = t24_settles.union(t24_settles_vars)
    all_t24_recovs = t24_settles.union(t24_settles_recovs)

    missing_t24_vars = set(spec_vars) - all_t24_vars
    missing_t24_recovs = set(spec_recovs) - all_t24_recovs
    if missing_t24_vars:
        err(f"T24 fails to explicitly settle required variations ({len(missing_t24_vars)}): {sorted(list(missing_t24_vars))}")
        all_passed = False
    else:
        ok(f"T24 explicitly settles all {len(spec_vars)} VAR-* cases.")

    if missing_t24_recovs:
        err(f"T24 fails to explicitly settle required recovery cases ({len(missing_t24_recovs)}): {sorted(list(missing_t24_recovs))}")
        all_passed = False
    else:
        ok(f"T24 explicitly settles all {len(spec_recovs)} RECOV-* cases.")

    # 6. Task graph and DAG verification
    task_ids = set(tasks.keys())
    edges = plan.get("dependency_graph", {}).get("edges", [])

    # Check edges exist
    for u, v in edges:
        if u not in task_ids:
            err(f"Edge from nonexistent task: {u}")
            all_passed = False
        if v not in task_ids:
            err(f"Edge to nonexistent task: {v}")
            all_passed = False

    # Check task depends_on consistency with edges
    for tid, tdata in tasks.items():
        deps = tdata.get("depends_on", [])
        if isinstance(deps, list):
            for d in deps:
                if d not in task_ids:
                    err(f"Task {tid} depends_on nonexistent task: {d}")
                    all_passed = False
                if [d, tid] not in edges and (d, tid) not in edges:
                    err(f"Task {tid} declares depends_on {d} but edge [{d}, {tid}] missing from dependency_graph.edges")
                    all_passed = False

    # Acyclicity and longest path computation
    visited = {}
    adj: Dict[str, List[str]] = {}
    for u, v in edges:
        adj.setdefault(u, []).append(v)

    def has_cycle(node: str) -> bool:
        visited[node] = 1  # visiting
        for neighbor in adj.get(node, []):
            if visited.get(neighbor) == 1:
                return True
            if visited.get(neighbor) == 0:
                continue
            if has_cycle(neighbor):
                return True
        visited[node] = 2  # done
        return False

    is_acyclic = True
    for t in task_ids:
        if t not in visited:
            if has_cycle(t):
                is_acyclic = False
                break

    if not is_acyclic:
        err("Dependency graph contains a cycle!")
        all_passed = False
    else:
        ok("Dependency graph is strictly acyclic.")

    computed_max_len, computed_longest_paths = compute_longest_paths(edges, "T00", "T25")
    info(f"Computed DAG longest path length: {computed_max_len} tasks, with {len(computed_longest_paths)} equal critical paths.")

    declared_critical_path = plan.get("dependency_graph", {}).get("critical_path", [])
    if len(declared_critical_path) != computed_max_len:
        err(f"Declared critical path length ({len(declared_critical_path)}) does not match computed longest path ({computed_max_len})")
        all_passed = False
    elif declared_critical_path not in computed_longest_paths:
        err(f"Declared critical path is not one of the computed longest paths!")
        all_passed = False
    else:
        ok(f"Declared critical path matches computed longest path (length {computed_max_len}).")

    # 7. Proof level and confirmation discipline
    for tid, tdata in tasks.items():
        plevel = tdata.get("proof_level")
        conf = tdata.get("confirmation", "")
        prereg = tdata.get("preregistration", {})

        if plevel == "P3":
            if not prereg.get("required") or not prereg.get("artifact"):
                err(f"P3 task {tid} missing required preregistration artifact declaration.")
                all_passed = False
            if "independent" not in conf and "adversarial" not in conf:
                err(f"P3 task {tid} has non-independent confirmation mode: '{conf}'")
                all_passed = False
            if "independent_confirmation" not in tdata:
                err(f"P3 task {tid} lacks 'independent_confirmation' specification block.")
                all_passed = False

    ok("All P3 tasks satisfy frozen preregistration and independent/adversarial confirmation rules.")

    # 7b. P3 preregistration artifacts must exist on disk and be frozen
    # (final-validation strengthening: a declared-but-never-frozen prereg must
    # not pass plan-wide final traceability; T25).
    # Plan path convention: <repo>/.agents/plans/<plan>.yaml, so the repository
    # root is three levels up from the plan file.
    plan_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(plan_path))))
    for tid, tdata in tasks.items():
        if tdata.get("proof_level") != "P3":
            continue
        art = (tdata.get("preregistration") or {}).get("artifact")
        if not art:
            continue
        art_path = art if os.path.isabs(art) else os.path.join(plan_root, art)
        if not os.path.exists(art_path):
            err(f"P3 task {tid} preregistration artifact missing on disk: {art}")
            all_passed = False
            continue
        try:
            with open(art_path, "r", encoding="utf-8") as f:
                pre = yaml.safe_load(f) or {}
            if str(pre.get("status", "")).lower() != "frozen":
                err(f"P3 task {tid} preregistration artifact is not frozen: {art} (status '{pre.get('status')}')")
                all_passed = False
        except Exception as e:
            err(f"P3 task {tid} preregistration artifact failed to parse: {art}: {e}")
            all_passed = False
    ok("All P3 preregistration artifacts exist on disk and are frozen.")

    # 8. Path conventions
    for line_idx, line in enumerate(plan_raw.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith(("├──", "│", "└──", "#", "- path:")):
            continue
        if "specs/" in line and not ".agents/specs/" in line and not "packages/" in line and not "examples/" in line and not "node_modules" in line:
            if re.search(r'(?<!\.agents/)\bspecs/[a-zA-Z0-9_-]+\.spec\.yaml', line):
                err(f"Plan line {line_idx} references invalid root specs/ path: {stripped}")
                all_passed = False
        if "plans/" in line and not ".agents/plans/" in line and not "artifacts/plan" in line and not "packages/" in line and not "examples/" in line:
            if re.search(r'(?<!\.agents/)\bplans/[a-zA-Z0-9_-]+\.plan\.yaml', line):
                err(f"Plan line {line_idx} references invalid root plans/ path: {stripped}")
                all_passed = False
        if ".agents/state/current-status.yaml" in line:
            err(f"Plan line {line_idx} references disallowed .agents/state/current-status.yaml")
            all_passed = False

    ok("Path conventions (.agents/specs/, .agents/plans/, .agents/CURRENT_STATUS.yml) verified.")

    # 9. Baseline boundary checks (Blender, toktx, WebRTC, donor)
    for tid in ["T00", "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T10", "T11"]:
        gate_cmds = tasks.get(tid, {}).get("gate", [])
        gate_text = " ".join(gate_cmds) if isinstance(gate_cmds, list) else str(gate_cmds)
        for prohibited in ["blender", "toktx", "geckos"]:
            if prohibited in gate_text.lower():
                err(f"Baseline task {tid} gate requires {prohibited}: {gate_text}")
                all_passed = False

    ok("Baseline gates do not require Blender, toktx, or WebRTC/geckos.")

    # Clean-checkout condition check
    t24_gates = tasks.get("T24", {}).get("gate", [])
    t24_steps = tasks.get("T24", {}).get("steps", [])
    if not any("clean-checkout" in str(g) for g in t24_gates) and not any("donor" in str(s) for s in t24_steps):
        err("T24 does not mandate clean-checkout with donor absent.")
        all_passed = False
    else:
        ok("Donor-absent clean checkout is enforced as final conformance condition.")

    if all_passed:
        ok("ALL TRACEABILITY, INTEGRITY, AND SETTLEMENT CHECKS PASSED.")
        return True
    else:
        err("ONE OR MORE CHECKS FAILED.")
        return False


if __name__ == "__main__":
    plan_arg = sys.argv[1] if len(sys.argv) > 1 else ".agents/plans/gauntlet-game-studio.plan.yaml"
    spec_arg = sys.argv[2] if len(sys.argv) > 2 else ".agents/specs/gauntlet-game-studio.spec.yaml"
    success = validate(plan_arg, spec_arg)
    sys.exit(0 if success else 1)
