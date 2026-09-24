# T26 finding: Poly Haven live API drift (provider adapter follow-up)

- date: 2026-09-19
- severity: provider-adapter limitation; asset.resolve behaved correctly and honestly
- evidence: artifacts/plan/T26/live-smoke.json, artifacts/plan/T26/live-smoke-decision.json

## Observation

The live smoke (`studio asset resolve barrel --role prop --keywords barrel --project … --json`)
reached the real Poly Haven API, matched five models, and attempted acquisition of each in
order. Every candidate failed with the typed outcome `UNEXPECTED_PAYLOAD: exposes no
downloadable GLB file`, and the resolver returned a typed `failed` result with the complete
step trace and an append-only decision record (`decision.route = acquire`, reason "all 5
provider matches failed acquisition").

Root cause: the settled Poly Haven adapter (CORR-02) extracts a flat `files.gltf.glb` entry.
The live API now nests GLTF downloads per resolution (`files.gltf.<8k|4k|2k|1k>.gltf.{url,md5,include}`)
and serves a `.gltf` scene bundle with separate texture `include` entries rather than a
self-contained flat `glb` key. Verified directly against `https://api.polyhaven.com/files/<id>`
on 2026-09-19.

## Why this does not affect the asset.resolve settlement

The resolver's contract is routing policy; acquisition deliberately flows through the settled
asset.source intake as the single acquisition primitive (REQ-ASSET-011). The provider failure
is faithfully surfaced as typed evidence with an append-only decision — the exact behavior the
policy requires when acquisition cannot complete. Fixture-based intake (the settled gate data)
continues to pass; only the live payload shape drifted.

## Proposed follow-up (scoped adapter correction, separate from T26)

Update `PolyHavenAssetSource.intakeAsset` to the current files payload: select
`files.gltf.<resolution>.gltf`, download the `.gltf` scene plus its `include` texture set,
hash every file, and record the multi-file runtime representation in the pending AssetRecord.
Update the fixture network data accordingly. This is a provider-adapter correction under the
existing asset.source contract — no normative change required.
