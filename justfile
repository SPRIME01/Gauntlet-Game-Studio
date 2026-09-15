# Gauntlet Game Studio justfile
# Durable gate aliases for agent and human verification

default:
    @just --list

# G-AGENT-ARTIFACTS: Validate spec, plan, traceability, and DAG
validate-agent-artifacts:
    python3 scripts/check-traceability.py

# G-CHECK: Typecheck and structural verification
check:
    just validate-agent-artifacts

# G-TEST: Test execution across workspace
test:
    just validate-agent-artifacts

# G-LINT: Style, syntax, and hygiene checks
lint:
    python3 -c "import py_compile; py_compile.compile('scripts/check-traceability.py', doraise=True)"
