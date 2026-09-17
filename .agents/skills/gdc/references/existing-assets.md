# Existing asset package

Read this guide when the user supplies models, textures, audio, animation, source files, or a complete asset package.

1. Inventory every file by intended role, format, source, license or authorization, and whether it is reference-only or shipped content.
2. Inspect the current `assets/manifest.json` before creating records. Reuse stable asset IDs and avoid parallel records for the same derivative.
3. Validate untrusted files and paths before privileged execution. Preserve source hashes and reject traversal, archives, or generated code that fails the project's safety gates.
4. Map runtime representations explicitly. A mesh, node, collider, socket, animation, or DCC custom property is an affordance; authoritative gameplay meaning remains in game state.
5. Route ordinary glTF pruning, LOD, and texture compression through `asset.optimize`. Route rigging, retargeting, topology, UV, or baking work through `dcc.blender.process` only with an escalation rationale.
6. Record the production `AssetRecord`: provenance, construction route, runtime representation, budgets and measured values, collider/LOD policy when required, affordances, and acceptance state.
7. Run deterministic asset verification before code relies on the asset. Unknown provenance, an unacceptable license, missing required policy, or a budget failure blocks acceptance unless project policy permits and records a specific waiver.
8. Include missing tools, provider credentials, downloads, conversion side effects, and expected committed derivatives in pre-flight.

Do not ask the user for facts that file inspection, embedded metadata, the asset manifest, or authoritative license research can establish. Ask only when ownership/authorization or intended product behavior remains unknowable.
