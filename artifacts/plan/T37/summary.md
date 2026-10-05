# T37 — Whole-Studio Settlement (Game Actualizer, spec v0.5.1)

Settled: 2026-10-04. Confirmation: independent_adversarial (third-round CONFIRM on T34/T35; this
summary is the whole-studio record).

## Settlement evidence

- Clean checkout with donor absent: conformance:clean-checkout 13 PASS / 0 FAIL.
- Conformance battery: recovery 22 PASS / 0 FAIL / 1 delegated (after the v0.5.1 ABI clarification
  resolved the RECOV-003 collision); security 6 PASS / 0 FAIL.
- Full workspace: 537 tests pass / 0 fail (59 files, 3290 expects). just ci: SUCCESS.
- Traceability: 224/224 REQ mapped on the final tree; plan bound to spec v0.5.1
  (a071663769fb25618eaaed4a070b0b6739709a9c3a5516527e1eed037abb9f2f); DAG acyclic; critical path intact.
- Live authority matrix: 12/12 server checks (boot/auth, MCP agent-only, human-op refusal, structured
  errors, tool-schema rejection of self-acceptance).
- Canonical-checksum sweep: calling every tool in the registry leaves game.spec.yaml byte-identical.
- Final diff inspection (09ff875..HEAD): 97 files, all within declared paths; zero donor references in
  runtime code; Product Actualizer used as architectural donor only; .jolli user tool state untouched.

## Per-task confirmation ledger

- T29 Game Model + staleness: independent_adversarial CONFIRM (4 defects found and fixed same-round).
- T30 resource resolution + reservoir: REJECT → correction round 1 → fresh adversarial CONFIRM.
- T31 normalization/GLB ABI/DCC/animation: builder_with_teeth (P2), teeth recorded.
- T32 Godot backend/world manifest/observability: independent_adversarial CONFIRM (+ hardening round).
- T33 quality bar/Game Case/release matrix: peer (P2), gates + teeth recorded.
- T34/T35 Game Cockpit: REJECT → correction 1 → REJECT (narrow) → correction 2 → focused CONFIRM.
- T36 MCP/WebMCP: implemented with live authority matrix + registry checksum sweep.

## Spec clarification under the correction protocol

v0.5.1 (SPEC_AMENDMENT recorded): REQ-GLB-001 scoped to mesh geometry after the GLB ABI gate collided
with settled T13/T14/T15/T18 committed evidence (RECOV-003). No requirement weakened; procedural and
environment-composition routes preserved; plan rebound; traceability re-verified.

## Genuinely blocked by environment (honest, not claimed)

- Godot binary absent: export/export-test unproven; typed TOOLCHAIN_UNAVAILABLE is the conformant state.
- iOS/Android toolchains absent: those targets remain unknown/blocked in the release matrix.
- SwiftShader software rendering: cannot settle hardware-bound profiles (enforced, not worked around).

## Remaining gaps (real, carried honestly — not optional enhancements)

1. Cockpit rail content is structural (system-owned, uncoverable, prohibition-compliant) but its data
   fields are not yet wired to the projection — the rail is static text in the web shell.
2. Web-client source-binding depth: the server grammar is bounded and schema-proven, but the client
   renders inline data; source-bound table rendering is surface work.
3. Viewport target is a free agent string (loopback sandbox mitigations; needs a product decision).
4. Asset-kind reservoir routing honors R1 only for non-accepted-project cases by design; composite R4
   cannot yet be a chosen route (fail-closed).
5. Cockpit surface polish per verifier round-1 classifications (North Star dedicated surface, Resource
   Scout why-route-wins detail, terminal interpreter, affordance-graph states) — projected data exists;
   dedicated surface rendering is remaining work.

Next highest-leverage move: wire the release rail's data fields to the projection and complete the
web-client source binding — they convert the cockpit's proven machinery into the owner-visible
experience the mission describes.

## Follow-up (2026-10-05): gaps 1-2 closed

The release rail now renders its thirteen derived fields (see followup-rail-and-source-binding.md)
and the web client renders source-bound blocks from the bounded grammar. 542/542 tests; just ci green.
