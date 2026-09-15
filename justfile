# Gauntlet Game Studio justfile
# Durable gate aliases for agent and human verification

default:
    @just --list

# G-AGENT-ARTIFACTS: Validate spec, plan, traceability, and DAG
validate-agent-artifacts:
    python3 scripts/check-traceability.py
    python3 scripts/check-topology.py

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
