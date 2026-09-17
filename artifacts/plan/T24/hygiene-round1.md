# T24 Post-Confirmation Hygiene Round 1

Recorded after the independent CONFIRM verdict, addressing the verifier's three
minor non-blocking findings before settlement commit. No acceptance weakened.

1. **SEC-01 self-trip prevention**: summary.md no longer reproduces the T03
   canary literal (described, not quoted), so committing this evidence cannot
   trip the secret scan. Rationale recorded in the confirmation record.
2. **Phrasing precision**: the branding-classification baseline is described as a
   per-line heuristic (it never was exact-content); the secret baseline remains
   exact file+line content.
3. **Null-byte hardening**: `safeIntakePath` (packages/adapters/src/assets/polyhaven.ts)
   now rejects path segments containing NUL bytes explicitly instead of relying
   on Node fs refusal (defense in depth, REQ-SEC-002).

Fresh verification after edits: bun run conformance:security (exit 0),
bun test packages/adapters (green), just check / just test / just lint /
just validate-agent-artifacts (all exit 0). See hygiene-gate.txt.

## Correction round 2 (post whole-studio confirmation finding)
Once scripts/conformance-security.ts was committed (7307668), the secret scanner
self-matched the verbatim canary literal inside its own SECRET_BASELINE
declaration (fail-closed; conformance:security exited 1 at HEAD — failure
preserved in security-correction2-failure.txt). Correction: a self-declaration
baseline entry whose exactContent equals the scanner's own trimmed source line
(the comparator trims). Preserved evidence chain:
security-correction2-failure.txt → security-correction2-gate.txt (green).
No acceptance weakened: unexpected hits still fail; the T03 canary
classification is unchanged.
