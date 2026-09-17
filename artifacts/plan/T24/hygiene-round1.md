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
