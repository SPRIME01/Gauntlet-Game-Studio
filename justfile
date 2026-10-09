# Gauntlet Game Studio justfile
# Durable gate aliases for agent and human verification

default:
    @just --list

# G-AGENT-ARTIFACTS: Validate spec, plan, traceability, and DAG
validate-agent-artifacts:
    python3 scripts/check-traceability.py
    python3 scripts/check-topology.py

# Run studio doctor diagnostics
doctor:
    bun run studio -- doctor

# G-CHECK: Typecheck and structural verification
check:
    just validate-agent-artifacts
    bun x tsc --noEmit

# G-TEST: Test execution across workspace
test:
    just validate-agent-artifacts
    bun test

# G-LINT: Style, syntax, topology, and hygiene checks
lint:
    just validate-agent-artifacts
    python3 -c "import py_compile; py_compile.compile('scripts/check-traceability.py', doraise=True); py_compile.compile('scripts/check-topology.py', doraise=True)"

# G-CI: Aggregate alias composing the existing repository-native gates.
# No competing parallel protocol: binds only the settled gates below.
ci:
    just check
    just test
    just lint
    just validate-agent-artifacts
    just doctor

# Download Git LFS archives first; normalize into an ignored, reproducible catalog.
foundations-import:
    python3 scripts/foundations/import_quaternius.py

# Safe offline source tests and runtime/catalog contract tests.
foundations-test:
    python3 -m unittest discover -s scripts/foundations -p 'test_*.py'
    bun test packages/studio/test/foundations/catalog.test.ts packages/runtime/test/humanoid-animation.test.ts packages/runtime/test/humanoid-prefab.test.ts packages/runtime/test/lighting-presets.test.ts

# Re-ingest archives (requires LFS payloads), verify contracts and static typing.
foundations-verify:
    just foundations-import
    just foundations-test
    bun x tsc --noEmit

# Run the actual LFS-backed character/animation proof in Playwright Chromium.
# Requires the example workspace's matching browser: 
# node examples/blackwater-relay/node_modules/playwright/cli.js install chromium
foundations-real-browser:
    bun run scripts/foundations/real-browser/run.ts
