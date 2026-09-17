# GDC evaluation — round 1

Date: 2026-09-17

Skill under test: `.agents/skills/gdc/SKILL.md`

Shared live inspection:

- `bun run studio -- doctor --json`: success; 5/5 checks passed on Bun 1.4.0, Linux x64.
- `bun run studio -- config --json`: success; default browser/Three.js project, Rapier/Recast/BVH enabled, multiplayer disabled, 60 FPS with 150 draw-call and 200,000-triangle defaults.
- `bun run studio -- capabilities --json`: success; 16 stable capabilities found.
- `bun run studio -- capabilities lint --json`: success; zero routing issues.
- Worktree inspection found unrelated pre-existing Jolli and `.serena/` changes; the eval did not touch them.

These are initial-turn forward evals. In accordance with the skill, no game mutation, provider invocation, or build run occurred before the simulated user confirmed a pre-flight gate.

## Test 1 — raw idea with no assets

### Prompt

> I want to make a browser game where you pilot a repair skiff through flooded ruins, salvage relay parts, and restore one beacon. I have no assets or design document, and I’m not technical. Take me from this idea to a playable build.

### What the skill caused

1. Inspected Studio health, resolved defaults, capability routes, template, and no-asset guidance before asking the user anything.
2. Classified the request as an idea-stage browser game rather than asking for a formal game-design document.
3. Inferred a small loop: pilot, find one relay part, return it to a beacon, activate the beacon, finish.
4. Kept the initial asset set small and routed it to project-owned procedural blockout, canonical terrain, environment composition, physics/navigation, and deterministic browser proof.
5. Recorded reversible defaults instead of asking about facts Studio already supplied.
6. Identified camera/presentation as the one product decision that materially changes controls, scene composition, UI, and proof scenarios, then asked one three-option question.

### Output produced

> I can take this from the idea to a playable browser build. Studio is healthy, exposes the required terrain, physics, navigation, environment-composition, asset, audio/VFX, and browser-proof routes, and has an independent game scaffold.
>
> **Provisional smallest loop:** launch at a repair dock, pilot through one flooded-ruin route, collect one relay part, return to the damaged beacon, install the part, and finish on visible beacon activation.
>
> **Explicit assumptions:**
>
> - A1: Start as single-player because the prompt does not require multiplayer; this avoids activating an unnecessary server/replication route.
> - A2: Target desktop browser at the inspected 60 FPS baseline; revise before pre-flight if a mobile target is chosen.
> - A3: Use project-owned procedural geometry for the first playable environment and skiff unless its acceptance criteria later require sourced or reference-backed art.
> - A4: Keep audio procedural and limited to engine, pickup, and beacon events; headless tests use the null backend.
>
> The remaining material decision is the view and control model:
>
> | # | Option | Justification |
> |---|---|---|
> | 1 ✓ | **[Recommended] Third-person chase camera** | Best exposes the skiff, flooded route, carried part, and beacon consequence in the Studio's pixel-proof channel while fitting the existing Three.js vehicle and camera specialist routes. |
> | 2 | Top-down/isometric view | Prefer this for simpler navigation and lower visual-asset demands, but it changes the piloting feel and scene-composition requirements. |
> | 3 | First-person cockpit | Prefer this for immersion, but it adds cockpit/UI work and makes external skiff and cargo consequences harder to prove visually. |

### Friction, gaps, and unexpected behavior

- Pass: no repository-answerable question was asked.
- Pass: the question had exactly three choices, one recommendation, and project-specific justifications.
- Pass: the skill stated every inferred default.
- Expected stop: the run correctly did not create a project or start a build before resolving the material camera decision and later presenting pre-flight.
- Minor friction: the path from this first decision to the final pre-flight spans multiple turns; the skill relies on the assumption register and build brief to preserve continuity but does not prescribe where that working brief should be saved before project creation.

## Test 2 — complete specification and accepted assets

### Prompt

> I have a complete browser-game specification in `.agents/specs/game.spec.yaml`, accepted assets in `assets/manifest.json`, and committed verification scenarios. Build exactly that specification and verify the full suite. Don’t reopen settled choices unless the files conflict or a required input is missing.

### Evaluation setup

The prompt was evaluated at `examples/blackwater-relay/`, where the asserted files exist. Inspection found a frozen game spec, seven accepted asset records, committed single-player and multiplayer scenarios, project-native build/test scripts, and accepted img2threejs, 3dviz, and Blender result records.

### What the skill caused

1. Treated the package as build-ready and preserved its frozen decisions.
2. Inspected the spec, asset manifest, capability results, scripts, suites, and evidence instead of interviewing the user.
3. Avoided reopening controls, mechanics, multiplayer mode, budgets, providers, or asset routes.
4. Produced a zero-blocker pre-flight centered on existing Studio CLI and project-native commands.
5. Stopped for explicit confirmation before starting the build and full verification suite.

### Output produced

> **Pre-flight summary — Blackwater Relay exact-spec build**
>
> - **Target:** existing `examples/blackwater-relay` browser game; build and verify the committed specification without adding mechanics or assets.
> - **Scope:** project build, single-player E2E, optional authoritative multiplayer suite, asset gates, and committed `suite all` Gauntlet settlement. Teeth/fault-injection fixtures remain validation tools, not product scenarios.
> - **Unresolved inputs:** none.
> - **Assumptions:** none beyond the user's explicit instruction to use the frozen spec as product authority.
> - **Inputs present:** frozen game spec; seven accepted asset records; committed capability requests/results for world composition, transceiver reconstruction, and service-drone DCC work; named quality profiles; committed expectations and suites.
> - **Routes:** no generation or provider rerun is needed. Existing accepted derivatives are consumed and deterministically re-verified.
> - **Environment:** Studio Doctor passed 5/5 checks; Bun 1.4.0 is available; capability lint reports zero issues. Browser availability will be exercised by the committed proof commands.
> - **Planned commands:** `bun run studio -- doctor --json`; `bun run studio -- capabilities lint --json`; `bun run studio -- asset verify --all --json`; `bun --cwd examples/blackwater-relay run build`; project E2E and multiplayer scripts; `bun run studio -- verify --project examples/blackwater-relay --suite all --json`.
> - **Artifacts:** generated bundle, immutable observation/evidence runs, and appended settlement records under the project-declared artifact locations.
> - **Evidence:** each scenario settles state, pixels, telemetry, and network evidence where applicable; structural performance uses the preregistered profile and does not claim target-hardware performance.
> - **Blockers:** none.
>
> | # | Option | Justification |
> |---|---|---|
> | 1 ✓ | **[Recommended] Proceed with this build** | The frozen spec, accepted assets, committed suites, native commands, and Studio gates are all present. |
> | 2 | Revise the pre-flight plan | Use only if the requested suite or artifact scope should differ from the frozen package. |
> | 3 | Stop after planning | Preserve this execution-ready plan without running build or verification commands. |

### Friction, gaps, and unexpected behavior

- Pass: no unnecessary product question was asked.
- Pass: accepted provider outputs were reused rather than regenerated.
- Pass: Studio CLI was the control surface for diagnosis, asset verification, and final settlement; project scripts remained responsible for their native build/tests.
- Pass: the output reached a confirmation-ready pre-flight with no unresolved inputs.
- Minor friction: several CLI actions infer a project from the current working directory while `verify --project` accepts an explicit path. The skill says to inspect the project boundary but does not explicitly require recording the working directory for every path-sensitive CLI command.

## Test 3 — reference-backed prop plus asset-poor new level

### Prompt

> Add an abandoned observatory level to my existing game. Keep its controls, mechanics, and performance budgets. I have a PNG concept sheet for one specific telescope prop but no environment assets. Use the image only as reconstruction reference, source legally usable materials where needed, and validate the finished level.

### Evaluation setup

The existing game was again `examples/blackwater-relay/`. Inspection preserved its controls, mechanics, authority model, and structural budgets. An exhaustive image inventory found the existing field-transceiver reference and proof screenshots, but no telescope concept sheet. The registered `asset.source` capability exists, while the current CLI advertises non-verify asset actions as typed placeholders.

### What the skill caused

1. Preserved the existing game decisions rather than asking about controls, mechanics, or budgets.
2. Separated the telescope from the environment: the specific telescope belongs to `asset.reconstruct.reference-image`; observatory layout belongs to `world.environment.compose`; terrain/navigation stay under their own authorities.
3. Refused to reuse unrelated screenshots or the transceiver image as the telescope reference.
4. Specified the missing reference precisely and surfaced the current CLI sourcing limitation.
5. Stopped before pre-flight because the reference input and executable environment-asset route were unresolved.

### Output produced

> The existing game already answers the control, mechanic, authority, and performance questions, so I will preserve them. The observatory needs two separate routes:
>
> - the **specific telescope** routes to `asset.reconstruct.reference-image` and remains backed by reference-only imagery;
> - the **observatory environment** routes to accepted assets plus `world.environment.compose`; terrain elevation and Recast navigation remain separate Studio authorities.
>
> Inspection found no telescope concept sheet in the project. The reference must show the complete telescope, uncropped, preferably in a three-quarter view with a clear silhouette, plain/high-contrast background, even lighting, and minimal occlusion. Use PNG, at least 1024 px on the shortest side as a quality recommendation, no larger than 32 MiB, with user authorization recorded. Front/side/back views are helpful if hidden geometry is acceptance-critical.
>
> The Studio catalog exposes `asset.source`, but the current CLI reports non-verification asset actions as placeholders. I will not bypass that contract silently. Choose the executable asset plan:
>
> | # | Option | Justification |
> |---|---|---|
> | 1 ✓ | **[Recommended] Add the authorized telescope PNG and use project-owned procedural observatory kits** | This satisfies the reference route while avoiding an unavailable CLI sourcing action; the kits can still be registered, budgeted, composed, and verified through current Studio gates. |
> | 2 | Add the PNG and authorize an external intake workflow | Prefer this when real licensed materials are required; source URI, author, retrieval metadata, license, and hashes must be recorded before acceptance, and the missing CLI source action remains an explicit execution dependency. |
> | 3 | Drop the depicted telescope and use procedural assets throughout | Prefer this only if fidelity to the concept sheet is no longer required; it avoids img2threejs and external sourcing but changes the requested representation. |

### Friction, gaps, and unexpected behavior

- Pass: the skill did not ask for information already present in the existing game.
- Pass: it applied the exact reference formats, size ceiling, content guidance, authorization, and reference-only boundary.
- Pass: it kept reconstruction, composition, terrain, and navigation capabilities separate.
- Pass: all three options resolve both the missing reference path and the unavailable CLI sourcing route without a hidden downgrade.
- Expected blocker: execution cannot reach pre-flight until the user supplies/chooses the asset route.
- Material product gap exposed: `asset.source` is routable in the catalog but has no implemented Studio CLI intake action. The skill handles this correctly as a scoped blockage, but a no-assets build needing external content cannot be fully automated through the CLI as it stands.

## Round summary

| Criterion | Result |
|---|---|
| Idea-only user can enter a path toward a completed build | Pass; GDC formed a smallest loop and asked one consequential choice. |
| Full-spec user avoids unnecessary friction | Pass; no product decisions were reopened. |
| No codebase/research-answerable questions | Pass in all three outputs. |
| Every question has exactly three justified options and one recommendation | Pass. |
| No build begins with unstated or unresolved inputs | Pass; each run stopped at the correct decision or pre-flight gate. |
| Existing skills/capabilities are coordinated, not duplicated | Pass. |
| Studio CLI is used wherever relevant | Pass, with the `asset.source` placeholder correctly surfaced. |

No skill revision was required by this evaluation round. The user approved the results on 2026-09-17 and authorized the remaining description evaluation, validation, and packaging to proceed without intermediate feedback gates.
