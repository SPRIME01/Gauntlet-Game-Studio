# Discovery: FIND → ADAPT → CREATE asset-routing policy (change candidate)

- status: change candidate — NOT normative; recorded during the Codename: Gauntlet Warfare repair run
- date: 2026-09-18
- companion spec-delta proposal: `.agents/reports/asset-resolve.spec-delta.proposal.md`
- discovered_by: operator instruction + repository observation during weapon-route repair
- governs_future: spec amendment candidate only; frozen requirements, gates, teeth, and provider-specific proofs remain untouched

## Observation

Free/open asset libraries (Kenney, KayKit, Poly Haven, Quaternius, and similar CC0/CC-BY
sources) can serve as additional asset-source providers. The studio already owns a
provider-neutral acquisition path — `asset.source` wired to the Poly Haven adapter and the
AssetRegistry (CORR-02, settled 2026-09-17) — so additional libraries fit as replaceable
adapters behind the same provenance/normalization/verification pipeline, not as new
authorities. Today's routing effectively begins at creation (procedural authoring or
reference reconstruction); there is no normative first-class step that searches for an
existing acceptable asset before generating one.

## Why it matters

- Generation is the most expensive and least reusable route; an existing CC0 asset that
  passes the same gates is cheaper and often higher fidelity.
- Per-asset license evidence matters: provider-level assumptions are unsafe (a "CC0
  library" can still contain separately-licensed items); provenance must stay per-asset.
- Making search/acquire → adapt → create explicit preserves the studio invariant that
  providers remain replaceable adapters below stable studio contracts (root AGENTS.md §4).

## Whether current settlement is affected

No. The frozen weapon route for Codename: Gauntlet Warfare is the operator-approved,
project-owned manual procedural authoring route (repair.plan.md, 2026-09-18); the stopped
img2threejs result stays preserved and unaccepted. No settled task, gate, tooth, or
provider-specific proof is re-decided by this discovery. The frozen run continues
unchanged at the semantic/settlement level.

## Affected future capabilities

- `asset.source`: additional library adapters (e.g., Kenney/KayKit CC0 packs) behind the
  existing intake contract, each preserving URI, author, license, retrieval metadata, and
  per-asset source hash.
- Future asset-dependent games: routing policy should prefer find → adapt, with creation
  (procedural, reference reconstruction, or DCC) as the fallback when no suitable asset can
  be acquired or adapted.
- AssetRegistry: no schema change required; per-asset provenance already required.

## Proposed normative change (spec delta, prepared for post-settlement amendment)

Introduce first-class `asset.resolve` routing with the policy: **search/acquire → adapt →
create**, where generation is the fallback only when no suitable existing asset can be
acquired or adapted under the declared acceptance criteria. Requirements:

1. Route resolution records which step found the asset and why later steps were unnecessary
   or failed (append-only decision evidence).
2. Every acquired asset passes the existing AssetRecord/provenance/normalization/verification
   pipeline; per-asset license evidence is mandatory; provider-level license assumptions are
   rejected.
3. No provider becomes authoritative; providers remain replaceable adapters.
4. Adaptation must preserve upstream license obligations and record the derivative
   relationship.

## Evidence / source notes

- CORR-2026-09-17 settled `asset source` CLI through the registered Poly Haven adapter and
  AssetRegistry with typed outcomes (`.agents/plans/gauntlet-warfare-prerequisite-correction.plan.yaml`).
- Codename: Gauntlet Warfare asset manifest distinguishes project-owned construction routes
  and records per-asset SHA-256 provenance (`codename-gauntlet-warfare/assets/manifest.json`).
- Operator instruction during this run authorized integrating additional providers only
  where they fit an existing provider-neutral contract without altering frozen requirements,
  and requested this discovery record plus a post-settlement spec delta.
- Current run behavior: no asset in the frozen run was re-sourced through a new provider;
  the weapon remains the approved manual route; environment remains the project-owned
  procedural composition.
