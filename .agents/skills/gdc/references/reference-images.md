# Reference-image route

Read this guide when the user provides concept art, a photo, or another image of a specific object or character, or when the build needs such a reference.

## Decide whether the route fits

Use `asset.reconstruct.reference-image` only for one specific depicted subject. Use world composition for environments, `world.terrain` for elevation, `world.navigation` for navmesh generation, and ordinary sourcing/procedural routes for generic asset needs.

## Specify a missing reference precisely

Tailor the request to the subject and the acceptance test. State all of the following:

- exact subject and required visible features;
- preferred view, camera angle, and orientation;
- framing: the full subject visible, uncropped, with clear silhouette and minimal occlusion;
- background and lighting: plain or high-contrast background, even light, and no heavy shadows when silhouette matters;
- resolution: recommend at least 1024 px on the shortest side for a single prop or character unless the inspected provider declares another need;
- format: `.png`, `.jpg`, `.jpeg`, or `.webp`, with each file no larger than 32 MiB;
- number of views: one clean view is the pipeline minimum; request front/side/back views when geometry hidden in one view is acceptance-critical;
- rights: user-authorized, project-owned, or clearly licensed/public-domain, with provenance and license stated.

The current adapter validates file existence, type, non-empty content, a 32 MiB ceiling, hash, and provenance fields. The 1024 px recommendation is a quality target, not a validator constraint; say so when precision matters.

## Prepare and verify

Create a strict request with:

- `capability_id: asset.reconstruct.reference-image`;
- `target_role` and output module path;
- `budget_limits`, including maximum triangles;
- `min_reference_similarity` appropriate to the subject;
- a `references` list with ID, project-relative path, provenance class, and license;
- acceptance criteria for standard Three.js imports, reference comparison, budgets, affordances, and offline verification.

Run the Studio prepare route to validate the references and create the `img2threejs` handoff. After the bound skill produces the module, use the existing acceptance and deterministic verification routes. Register named nodes, sockets, and colliders as asset affordances only; never promote them automatically to game semantics.

Keep the image reference-only. Do not ship it as production content merely because it was used to reconstruct geometry.
