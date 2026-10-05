# T32 — Godot Production Backend, Engine-Neutral World Manifest, Cross-Runtime Observability

Settled: 2026-10-04. Independent adversarial confirmation recorded in confirmation.md.

## What was built

- **WorldManifest contract** (`gauntlet.world.manifest` v1.0, strict): zones, placements (asset refs,
  transforms, sockets), scatter rules, lighting/atmosphere intent, collider intent, navigation surfaces
  (referenced, never generated — navmesh authority stays with the navigation capability), terrain_ref
  (referenced — terrain authority stays with the canonical TerrainHeightfield), spawn points, interaction
  anchors, LOD policy, streaming hints, derivative stamp. Studio module packages/studio/src/worldmanifest/
  manifest.ts: load/save with typed errors, pure reference validation, and two deterministic projections.
- **gauntlet-three projection** (`projectToThree`): reference-representation JSON, byte-identical across
  regenerations; terrain/nav remain references, never embedded data.
- **Godot projection** (`projectToGodot`): deterministic generation of project.godot, boot scene,
  world_builder.gd (constructs nodes from the embedded engine-neutral manifest at runtime),
  export_presets.cfg declaring per-target toolchain requirements, and the manifest itself. The generated
  project consumes normalized GLB via the same production asset ABI (REQ-GLB-001). Regeneration is
  byte-identical; scene artifacts are projections, never semantic authority (REQ-GODOT-006).
- **Export preflight** (`checkGodotExportPreflight`): declared toolchain requirements per target
  (godot.web / godot.android / godot.ios); absent godot binary or non-macOS host for iOS → typed blocked
  TOOLCHAIN_UNAVAILABLE with requirements named; studio operation unaffected; no readiness ever claimed.
  Verified live: `studio godot preflight --target godot.ios` returns blocked in this environment.
- **Cross-runtime observability** (packages/adapters/src/godot/observability.ts): wraps a Godot-provided
  JS bridge into the SAME versioned __GAUNTLET_STUDIO_OBS__ contract and validates with the runtime's own
  validator; in production mode BOTH the wrapped surface and the raw bridge pass the existing production
  mutation lockout inspector (a bridge smuggling control/pause/step fails exactly as a tampered reference
  surface). Absent bridge → typed GODOT_OBSERVABILITY_BRIDGE_UNAVAILABLE blockage, never fabricated reads.
- **Config** (REQ-GODOT-002): optional `production: { engine: "godot", targets: [...] }` block added to
  StudioConfigSchema — an explicit modeled distinction. `runtime.engine` remains literally "three"; existing
  configs (blackwater-relay) keep loading unchanged; invalid target ids rejected.
- **CLI**: `studio world validate|project`, `studio godot preflight|generate`.

## Gate results

- bun test full workspace: 475 pass / 0 fail (15 godot/worldmanifest tests).
- bun x tsc --noEmit: exit 0. check-traceability: PASS 224/224.

## Prereg falsifier outcomes

- TEETH-T32-001: Godot scene regeneration deterministic from manifest; mutated scene state is discarded on
  regeneration; manifest references (terrain/navigation) never embedded as engine data.
- TEETH-T32-002: godot-absent export → typed blocked; studio operation green; no readiness claimed.
- TEETH-T32-003: production-mode bridge carrying privileged mutation APIs rejected by the existing
  production surface inspector.
- TEETH-T32-004: production targets additive; reference runtime unchanged; existing game configs green.

## Environment confound (honest)

No Godot binary and no macOS/iOS toolchain in this environment. Conformance is the honest typed blocked
state plus deterministic generation; live export cannot be proven here and is NOT claimed.
