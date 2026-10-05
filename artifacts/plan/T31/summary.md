# T31 — Coherence Normalization, GLB Production ABI, Structured DCC Jobs, First-Class Animation

Settled: 2026-10-04. Confirmation: builder_with_teeth (P2) — teeth outcomes below.

## What was built

- NormalizationPlan contracts (`gauntlet.resource.normalization` v1.0): bound to model language sections,
  transform ops (units/scale/orientation/pivot/naming/skeleton/animation-naming/material-model/palette/
  roughness/metalness/normal-intensity/texel-density/texture-resolution/lod/collider/sockets/runtime-metadata/
  lighting-response), source provenance preserved (REQ-NORM-002), built_from stamp (REQ-STALE-001).
  Studio module packages/studio/src/normalize/plan.ts: build/persist/load/record-execution; undeclared
  language binding (including sub-keys) typed-rejected MODEL_LANGUAGE_UNDECLARED (REQ-GM-006 fog preserved).
- GLB production ABI (packages/studio/src/normalize/abi.ts + glb_abi gate inside the existing evaluateAsset):
  geometry roles (hero/character/vehicle/weapon/prop/environment/kit/mesh) must enter production as
  normalized glTF/GLB; provider object graphs rejected; non-geometry resources keep their own representations.
  No second verification path — the gate lives inside the settled asset acceptance evaluation.
- DccJob contracts (`gauntlet.dcc.job` v1.0) + packages/studio/src/dcc/jobs.ts: mandatory cascade_rationale
  (schema tooth naming cascade_rationale; weak rationale with zero cascade attempts rejected), capability must
  exist in the registry, operations limited to the structured DCC operation set (topology-cleanup, retopology,
  uv-edit, material-bake, bake, rig, skin, animate, retarget, bake-animation, mesh-repair, collision-proxy,
  lod-generate, kitbash-consolidate, export-normalize) — no gameplay-semantic ops exist to declare (REQ-DCC-002).
  Persisted under .studio/dcc-jobs/; consumed by the settled dcc.blender.process capability path.
- Animation domain first-class: capability descriptors animation.rig / animation.retarget / animation.bake /
  animation.validate registered with providers [dcc.blender], composition-first policy statements, and
  do_not_use_when boundaries preserving runtime/semantic ownership (REQ-ANIM-001/002). AnimationResourceContract
  (`gauntlet.animation.contract`) expresses base clips + additive/upper-body layers + model-owned semantics.

## Gate results

- bun test full workspace: 460 pass / 0 fail (12 normalization/DCC/animation tests).
- bun x tsc --noEmit: exit 0. capabilities lint: 0 issues.

## Teeth outcomes (preregistered attacks, all demonstrated)

- DCC job without cascade rationale → DCC_CASCADE_RATIONALE_REQUIRED (named tooth).
- Copy-paste rationale ("easier") with zero cascade attempts → rejected.
- DCC job naming unknown capability → DCC_CAPABILITY_UNKNOWN.
- Normalization plan binding to undeclared language or sub-key → MODEL_LANGUAGE_UNDECLARED.
- Geometry asset with non-GLB representation → glb_abi gate fail, production_acceptable false.
- Normalized derivative retains full provenance after execution recording (URI preserved).
