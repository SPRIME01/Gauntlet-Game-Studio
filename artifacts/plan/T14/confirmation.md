# T14 Independent Confirmation Record

- **Confirmation mode**: independent (per plan T14 preregistration)
- **Confirmed at**: 2026-09-16 (fresh verifier session; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM**
- **Scope**: REQ-BIND-006, REQ-ASSET-001, REQ-ASSET-002, REQ-ASSET-004

## Gates reproduced fresh (verifier's own runs, exit 0)
- `capability prepare asset.reconstruct.reference-image …transceiver.yaml --json` and
  `capability verify-result … --json` (all 13 checks PASS; recomputed IoU 0.8696 ≥ 0.5; 128 ≤ 2000 triangles;
  single three@0.170.0 runtime import)
- Credential-stripped, proxy-zeroed rerun: exit 0, `model_invocation: none`, `network_access: none`;
  poisoned `fetch` leaves verification passing and the module byte-unmodified
- `bun test packages/studio/test/capabilities` 27/0; `just check`/`just test` (238/238)/`just lint`/
  `just validate-agent-artifacts`

## Attacks (all failed)
1. Reference bypass: four invalid/missing reference variants all exit 1 `blocked`/`REFERENCE_REQUIRED` with
   `degraded_to_generic_text_to_3d: false` and allowed next steps; provider mismatch blocks too.
2. Single-Three integrity: forged second three@0.999.9 → exit 1 `MULTIPLE_THREE_INSTALLATIONS` naming both
   realpaths; staged import symlinks to the pinned realpath.
3. Determinism: three verify-result runs byte-identical; reference PNG regenerates byte-identical; tampering
   recorded similarity or moving geometry flips recomputed IoU and fails — the recompute chain has real teeth.
4. Authority boundaries: sockets/collider are Object3D userData metadata only; reference fixture registered
   reference-only and structurally barred from production records; accepted AssetRecord provenance is honest
   ("gauntlet coding agent (T14 interactive AgentHandoff run)").
5. Handoff honesty: premature settlement throws; lifecycle IDs/sha256s coherent across handoff/artifacts/result/
   manifest; skill content pinned to vendor metadata with id check.

## Honesty
summary.md discloses the 8×8 IoU as a deliberately coarse deterministic stand-in (proves recomputability, not
visual fidelity) and claims no live model integration.

## Recorded non-blocking observations
1. `REFERENCE_INVALID` is declared but never emitted; invalid references report `REFERENCE_REQUIRED` (still a
   typed, explicit block).
2. The result YAML's decorative `recorded_similarity` is not cross-checked against module evidence (the module
   side is; authoritative recompute chain is tamper-checked) — cosmetic.
3. Committed `transceiver.handoff.json` embeds an absolute machine-specific `resolved_path` (hygiene nit).
4. Plan `hot_context` names `vendor/img2threejs/` while pinned content lives at `vendor/skills/img2threejs/`
   (path drift only; attribution agrees).
