# T18 Independent Confirmation Record

- **Confirmation mode**: independent (per plan T18 preregistration)
- **Confirmed at**: 2026-09-16 (fresh verifier session at working tree atop f0a07cb; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM**
- **Scope**: REQ-BIND-011, REQ-BLENDER-001, REQ-BLENDER-002, REQ-BLENDER-003, REQ-BLENDER-004, REQ-BLENDER-005, REQ-BLENDER-006, REQ-BLENDER-007
- **Toolchain recorded**: Blender 5.2.2 LTS (/snap/bin/blender)

## Gates reproduced fresh (verifier's own runs, exit 0)
- `studio capability verify-result dcc.blender.process …/service-drone-retarget.yaml --json` — 11/11 checks, zero Blender at verify time
- `bun run test:blender-absent-build` — legs A–D green (game tests, build, typed blockage, donor isolation)
- `just check`, `just test` (335/335), `just lint`, `just validate-agent-artifacts`

## Attacks (all failed)
1. Blender independence: with blender stripped from PATH, `which blender` fails while game tests stay green;
   verify-result passes 11/11 offline; regeneration reports typed `BLENDER_UNAVAILABLE`
   (`scoped_to_regeneration: true`, `committed_derivatives_still_consumable: true`). Only
   packages/adapters/src/dcc/blender/ spawns Blender; no runtime/game/studio code invokes it.
2. Semantic authority: quest/NPC `dcc_metadata` rejected `DCC_METADATA_REJECTED` at definition intake
   (pre-Blender); quest/NPC metadata injected into GLB node extras (a surface beyond the builder's own layer-2
   test) with restamped artifact hash fails `AUTHORITY_BOUNDARY` as the sole failing check, offline; Koota runtime
   guard rejects Object3D in semantic state while benign affordance data stays inert. No `.blend` committed;
   accepted AssetRecord + GLB is the only runtime-facing artifact.
3. Reproducibility: verifier re-ran the real Blender 5.2.2 chain — GLB (`e0ff0f70…`), bake report (`fbb072e5…`),
   and raw GLB (`3e958572…`) reproduce byte-identically. Provenance records "5.2.2 LTS", source-definition sha256,
   and full argv invocation records. Attribution honestly records the `dcc_tooling` class (GPL-2.0-or-later,
   never shipped/imported) in vendor/attribution.json and THIRD_PARTY_NOTICES.md §6.
4. Derivative integrity: committed GLB is glTF 2.0, generator glTF-Transform v4.5.0 (normalization flowed),
   `hover_cycle` baked animation, 84 tris; manifest history append-only (intake → accept, origin `blender`);
   `asset verify --all` 7/7; game consumes it Blender-free.
5. Honesty: `.blend` byte non-determinism disclosed (output pinned by artifact hashes); zero-texture/WebP encoder
   limitation disclosed (loud failure, never downgrade); Blender 5.2.x regeneration caveat recorded.

## Prereg discipline
Prereg frozen (status: frozen; mtime precedes source definition, registry intake, and all evidence). Both
preregistered falsifiers reproduced fresh.

## Non-blocking observations
1. examples/blackwater-relay scene assembly does not yet place the drone in a scene — consumption is via the
   assets module and tests; scene assembly is T22 scope, and summary.md does not claim placement.
2. Texture-bearing DCC derivatives require a real WebP encoder; the pipeline fails loudly rather than downgrading.
