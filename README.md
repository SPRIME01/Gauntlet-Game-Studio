# Gauntlet Game Studio

**Gauntlet Game Studio turns a game specification and a set of references into a polished, browser-native 3D game—and does not call the work finished until the game proves what it can actually do.**

Coding agents can already write Three.js code, generate models, compose scenes, add physics, and drive a browser. The hard problem is not access to those capabilities. It is choosing the right representation for each job, keeping specialist tools from becoming competing sources of truth, and distinguishing a game that *looks finished* from one whose gameplay, rendering, navigation, physics, assets, and performance actually hold together.

Gauntlet Game Studio solves that coordination problem.

It routes each requirement to the smallest appropriate capability, composes specialized tools behind stable contracts, keeps authoritative game state separate from rendering and DCC representations, and closes every material development increment through a Gauntlet loop that observes **state, pixels, and telemetry**.

The result is a code-native game studio optimized for coding agents rather than for a human editor workflow.

```text
Game intent / references
          │
          ▼
  Game Studio Director
          │
          ▼
   Capability routing
          │
   ┌──────┼─────────────────────────────┐
   │      │                             │
   ▼      ▼                             ▼
 Worlds  Assets                      Game systems
 3dviz  img2threejs                  Needle / Koota
 terrain licensed assets             Rapier / Recast
         Blender escalation          BVH / UI / audio
   │      │                             │
   └──────┴──────────────┬──────────────┘
                         ▼
                  Running browser game
                         │
             ┌───────────┼───────────┐
             ▼           ▼           ▼
           State       Pixels     Telemetry
             └───────────┼───────────┘
                         ▼
                      Gauntlet
                         │
                 settle / correct
```

---

## What the studio changes

Without a coordinating representation, an agent sees a collection of powerful tools:

- a scene generator;
- an image-to-3D system;
- a renderer;
- an ECS;
- physics;
- navigation;
- Blender;
- asset libraries;
- VFX and audio packages;
- browser automation;
- testing tools.

That is not yet a game-development system.

Gauntlet Game Studio adds the missing layer: **capability routing, stable handoffs, authority boundaries, asset provenance, observability, and evidence-backed settlement**.

The agent starts from the job:

> Reconstruct this exact field radio from the image I supplied.

not:

> Use img2threejs.

Or:

> Build a storm-dusk relay station across a mountainous island with a traversable road network.

not:

> Use 3dviz, THREE.Terrain, and Recast.

The studio identifies the required capabilities, chooses the provider only after the job is understood, loads only the detailed skill context needed for that route, and verifies the consequence after integration.

That distinction keeps the agent's decision world small while preserving a large production toolbox.

---

## The operating model

A substantial game change follows one loop:

```text
Frozen requirement
      ↓
Capability
      ↓
Provider / representation
      ↓
Implementation
      ↓
Running consequence
      ↓
Observation
      ↓
Evidence
      ↓
Settlement
```

Failure is part of the loop:

```text
Expectation
    ↓
Implementation
    ↓
Observed consequence
    ↓
Mismatch
    ↓
Classify the blockage
    ↓
Correct the smallest falsified layer
    ↓
Observe again
```

The studio does not repeatedly regenerate until something looks acceptable. It asks what failed:

- Was the concept represented correctly?
- Was the chosen representation capable of expressing it?
- Was the provider appropriate?
- Did integration fail?
- Did the game state behave correctly but rendering fail?
- Did the visual result pass while performance failed?
- Is the missing thing a capability the studio does not yet possess?

That classification determines the next action.

---

# Capability routing

The studio exposes **capabilities**, not vendor names, as its stable interface.

A capability descriptor says:

- what the capability does;
- when to use it;
- when **not** to use it;
- what inputs it accepts;
- what normalized output it produces;
- which providers can satisfy it;
- what proof is required afterward.

Detailed provider instructions are loaded only after routing.

A simplified example:

```yaml
id: asset.reconstruct.reference-image

summary: Reconstruct a specific depicted object or character as procedural Three.js.

use_when:
  - A suitable reference image exists.
  - Fidelity to the depicted subject matters.

do_not_use_when:
  - The asset is generic.
  - A suitable accepted asset already exists.
  - The request is for terrain or environment composition.

preferred_provider: img2threejs

verification:
  - reference fidelity
  - semantic affordances
  - runtime integration
  - performance budget
```

This makes the provider replaceable without changing what the game asked for.

---

# The production stack

Gauntlet Game Studio deliberately combines narrow tools rather than asking one engine or generator to own the whole game.

| Capability | Preferred implementation | Responsibility |
| --- | --- | --- |
| Browser game runtime | **Needle Engine + Three.js** | Rendering, runtime lifecycle, components, browser delivery, physics integration |
| Authoritative game state | **Koota** | Entities, traits, relations, game semantics, systemic state |
| Physics | **Rapier through Needle** | Bodies, colliders, triggers, character/vehicle physical behavior |
| Navigation | **Recast Navigation** | Navmesh generation, paths, crowds, traversal |
| Spatial acceleration | **three-mesh-bvh** | Fast raycasts, line of sight, spatial queries |
| Scene/world composition | **3dviz-pro-max** | Environment design, architecture, vegetation, lighting, atmosphere |
| Terrain | **three.terrain.js** | Seeded heightfields and procedural terrain realization |
| Reference-image reconstruction | **img2threejs** | Specific image → procedural Three.js object or character |
| Gameplay/graphics/UI/QA expertise | **threejs-game-skills specialists** | Reusable specialist game-development knowledge |
| PBR/HDRI sourcing | **Poly Haven and approved sources** | Provenanced reusable production assets |
| glTF processing | **glTF-Transform** | Normalize, optimize, compress, prepare runtime assets |
| VFX | **three.quarks** | Agent-editable particle systems and effects |
| Procedural audio | **Tone.js** | Code-defined interaction, UI, ambience, and synthesized effects |
| Offline DCC escalation | **Blender** | Topology, UVs, baking, difficult rigging, retargeting, cleanup |
| Exploratory browser use | **agent-browser** | Open-ended inspection and debugging |
| Deterministic browser proof | **Playwright** | Reproducible scenarios, screenshots, interactions, traces |
| Settlement | **Gauntlet** | Compare frozen expectation with observed consequence |

The list is a set of current preferred bindings, not the domain model. A provider can be replaced if another implementation satisfies the same studio contract.

---

# Asset construction is routed by the problem

There is no generic "make a 3D asset" path.

## A specific depicted object

If the user provides an image and fidelity to that object matters:

```text
User reference
     ↓
img2threejs
     ↓
procedural THREE.Group
     ↓
semantic nodes / sockets / pivots
     ↓
runtime + asset acceptance
```

`img2threejs` is therefore **reference-image reconstruction**, not generic text-to-3D.

If no suitable reference exists, the studio prefers asking the user for one before falling back to approved project or licensed references.

## A generic asset

If the game simply needs a suitable crate, rock, surface, lamp, tree, or other common asset:

```text
Existing accepted project asset?
          │
       no ▼
Approved CC0/licensed asset?
          │
       no ▼
Simple procedural representation?
          │
       no ▼
Does Blender materially solve it?
          │
       no ▼
Optional generic generator, if policy allows
```

The studio does not spend generation effort merely because a generator exists.

## An environment

3dviz-pro-max decides composition and visual relationships:

- settlement structure;
- architecture;
- vegetation;
- scene rhythm;
- lighting;
- atmosphere;
- meaningful environmental detail.

Lower-level capabilities realize specialized parts underneath that direction:

```text
3dviz world intent
      │
      ├── terrain → three.terrain.js
      ├── traversal → Recast
      ├── repeated vegetation → instancing
      ├── spatial queries → three-mesh-bvh
      ├── sourced material → asset source
      └── bespoke reference object → img2threejs
```

No single provider needs to pretend it owns the whole world.

---

# Blender is the escape hatch, not the studio

Gauntlet Game Studio is code-native and browser-native.

Blender is used only when its additional representational power is actually needed—for example:

- retopology;
- difficult UV work;
- baking;
- complex rigging or skinning;
- animation retargeting;
- animation baking;
- mesh cleanup;
- DCC-specific transformation.

The route is explicit:

```text
Requirement
    ↓
Normal studio routes cannot satisfy it
    ↓
Blender escalation
    ↓
derived geometry / rig / animation / texture
    ↓
Needle-compatible runtime handoff
    ↓
Asset Registry
    ↓
Gauntlet verification
```

A `.blend` file never becomes authoritative game state.

Needle's Blender integration is used where it gives the cleanest handoff. Needle's Unity integration is intentionally outside the studio.

---

# Game state is not the scene graph

This is one of the studio's central architectural rules.

A rendered guard may be a `THREE.Object3D`, have a Rapier body, follow a Recast path, emit spatial audio, and display VFX. None of those representations owns what the guard *is* in game terms.

Authoritative game semantics live in the game-state layer.

For example:

```text
Koota entity: guard-07
├── Health
├── Faction
├── PatrolAssignment
├── AlertState
├── Inventory
└── ObjectiveRelation

projections
├── render → Needle / THREE.Object3D
├── physics → Rapier body
├── navigation → Recast agent
├── spatial → BVH queries
└── audio/VFX → runtime effect handles
```

Stable IDs correlate those projections.

Destroying a render mesh does not silently destroy a quest relationship. Moving a Blender bone does not become NPC intent. A navmesh does not become world semantics.

---

# Assets are production records, not loose files

Every production asset has an `AssetRecord`.

The record carries the information agents normally lose as a project grows:

```yaml
id: prop.field-transceiver

role: interactive_hero_prop

origin: user

construction_route: asset.reconstruct.reference-image

source_provenance:
  kind: user_provided_reference
  source_hash: "..."

runtime_representation: procedural_three

semantic_nodes:
  - power_switch
  - tuning_knob
  - antenna

collider_policy: simplified

lod_policy: hero

budget:
  quality_profile: desktop-high

acceptance_state: accepted
```

An AssetRecord can answer:

- Where did this asset come from?
- Is it safe to ship?
- Was the image only a reconstruction reference or directly incorporated?
- Which provider created it?
- Does it have required colliders?
- Which interaction nodes are meaningful?
- Has it passed its runtime budget?
- Has it been optimized?
- Was Blender involved?
- Which evidence accepted it?

Asset acceptance is part of production, not final cleanup.

---

# Observability: state + pixels + telemetry

A screenshot is evidence of appearance. It is not evidence that the game believed the correct thing happened.

Every development/test game exposes a stable observability bridge:

```text
window.__GAME_STUDIO__
```

The exact implementation is versioned, but the interface provides the controls and observations required for deterministic verification, including:

- readiness;
- pause/resume;
- deterministic seed control where applicable;
- bounded or fixed simulation stepping where supported;
- scenario load/reset;
- authoritative game-state reads;
- entity inspection;
- named camera views;
- scene correlation;
- physics inspection when relevant;
- navigation inspection when relevant;
- renderer statistics;
- performance telemetry;
- console/runtime errors.

Settlement uses whichever channels the claim requires.

### State

Answers questions such as:

- Does the player actually possess the power cell?
- Did the relay objective transition?
- Which target is the drone pursuing?
- Is the gate authoritative state open?

### Pixels

Answers:

- Did the gate visibly open?
- Is the hero object recognizable from the reference?
- Is the HUD legible?
- Did the beacon activate visibly?
- Is the scene composition working from the intended gameplay camera?

### Telemetry

Answers:

- Did frame time remain inside the quality profile?
- Did draw calls explode?
- Did texture or geometry usage regress?
- Did loading become unacceptable?
- Did the browser emit runtime errors?

A claim is not settled when one required channel contradicts another.

---

# The Gauntlet loop

Gauntlet is not a final QA pass bolted onto the studio.

It is the development loop.

For each settlement-critical increment:

1. Freeze the expectation.
2. Record the observation that would falsify it.
3. Implement the smallest coherent capability.
4. Run the game.
5. Observe required state, pixels, and telemetry.
6. Preserve the evidence.
7. Compare consequence with expectation.
8. Settle, or classify what prevented closure.
9. Correct the smallest falsified layer.
10. Re-run the original falsifier and confirmation path.

High-risk work uses preregistration and fresh independent/adversarial confirmation.

The evidence from failed attempts remains part of the project's developmental history.

---

# Browser roles

Two browser interfaces intentionally coexist.

## agent-browser — exploration

Use agent-browser when the coding agent needs to:

- explore the game;
- inspect a surprising visual result;
- take ad-hoc screenshots;
- interact experimentally;
- understand a failure;
- navigate an external source when policy allows it.

Its adaptability is useful during development.

## Playwright — proof

Use Playwright for:

- deterministic interaction;
- fixed scenarios;
- supported viewport checks;
- named-state screenshots;
- traces;
- reproducible input;
- visual regression;
- bot playtests;
- settlement evidence.

Proof must not self-heal around the condition it is meant to test.

---

# Skill orchestration

Only the **Game Studio Director** is the orchestration authority.

Provider and specialist skills are progressively disclosed after routing.

A skill description is intentionally small. It answers:

```text
What does this capability do?
When should I use it?
What nearby thing should I not use it for?
```

Studio-owned descriptions target roughly 200–400 characters. Detailed commands, workflows, edge cases, and provider-specific reasoning stay inside the activated skill and its references.

This prevents the agent from loading an entire virtual game studio into working context before it knows which room it needs.

---

# threejs-game-skills integration

Gauntlet Game Studio reuses the useful specialist knowledge from `threejs-game-skills` without allowing a second director to compete with studio routing.

Used as specialists:

- `threejs-gameplay-systems`
- `threejs-aaa-graphics-builder`
- `threejs-game-ui-designer`
- `threejs-debug-profiler`
- `threejs-qa-release`

Not used as orchestration authority:

- `threejs-game-director`

The Game Studio Director owns:

- capability routing;
- provider policy;
- continuity;
- provenance;
- Gauntlet handoff;
- settlement.

The package's generic generation skills remain optional fallbacks:

- `threejs-3d-generator`
- `threejs-image-generator`
- `threejs-audio-generator`

They are invoked only after studio routing concludes that preferred user-provided, sourced, procedural, specialized, or Blender routes do not satisfy the requirement and project policy permits generation.

The default integration is an overlay over the pinned upstream skills. A specialist is forked only if its provider/runtime/evidence assumptions cannot be constrained externally. In that case, only the affected skill is copied under `skills/vendor-overrides/`, with its upstream revision and local delta recorded.

---

# Repository model

Gauntlet Game Studio is a `pnpm`/TypeScript monorepo.

Runtime libraries remain normal pinned package dependencies. Agent-facing upstream projects whose skill/source content needs inspection are pinned under `vendor/`.

```text
gauntlet-game-studio/
├── AGENTS.md
├── README.md
├── LICENSE
├── package.json
├── pnpm-workspace.yaml
├── justfile
│
├── .agents/
│   ├── CURRENT_STATUS.yml
│   ├── specs/
│   │   └── agentic-threejs-game-studio.spec.yaml
│   ├── plans/
│   │   └── agentic-threejs-game-studio.plan.yaml
│   ├── preregistrations/
│   ├── decisions/
│   └── reports/
│
├── capabilities/
│   └── *.yaml
│
├── packages/
│   ├── contracts/
│   ├── capabilities/
│   ├── router/
│   ├── studio-cli/
│   ├── asset-registry/
│   ├── observability/
│   ├── evidence/
│   ├── gauntlet-bridge/
│   └── adapters/
│       ├── needle-runtime/
│       ├── koota-state/
│       ├── img2threejs/
│       ├── 3dviz/
│       ├── terrain/
│       ├── recast/
│       ├── bvh/
│       ├── gltf-transform/
│       ├── polyhaven/
│       ├── quarks/
│       ├── tone/
│       ├── blender/
│       └── browser/
│
├── skills/
│   ├── game-studio-director/
│   └── vendor-overrides/
│
├── vendor/
│   ├── img2threejs/
│   ├── 3dviz-pro-max/
│   └── threejs-game-skills/
│
├── templates/
│   └── game/
│
├── examples/
│   └── blackwater-relay/
│
├── scripts/
└── artifacts/
    └── runs/
```

The monorepo owns the studio.

Games created by the studio do **not** normally live inside it.

---

# Game projects are independent

A game created by the studio gets its own buildable project:

```text
my-game/
├── studio.lock.yaml
├── specs/
│   └── game.spec.yaml
├── src/
├── assets/
├── references/
├── tests/
├── .agents/
└── artifacts/
```

`studio.lock.yaml` records the studio/provider revisions needed to reproduce the project.

The game remains buildable without checking it out inside the Game Studio repository.

That boundary keeps studio evolution separate from game history.

---

# Studio CLI and `just`

There are two command surfaces because they serve different jobs.

## `studio`

`studio` is the semantic automation interface.

```bash
studio doctor
studio create <game>
studio capabilities
studio capability describe <capability>
studio capability run <capability> <request>
studio asset ...
studio observe ...
studio verify ...
studio evidence ...
```

Settlement-critical commands support structured machine-readable output and stable exit semantics.

Examples:

```bash
studio doctor --json
studio verify --profile desktop-high --json
studio evidence check <run-id> --json
```

Agents can therefore use the studio without scraping prose from terminal output.

## `just`

`just` is the ergonomic operator façade:

```bash
just --list
just doctor
just check
just test
just lint
just verify
just ci
```

Recipes call the semantic CLI and repository-native checks. They do not create a second domain API.

---

# Creating a game

From the studio repository:

```bash
pnpm install
just doctor
studio create ../my-game
```

Then enter the game:

```bash
cd ../my-game
just doctor
```

The generated project includes the studio contract surfaces needed by coding agents:

- game specification;
- studio lock;
- agent instructions;
- asset registry;
- observability bridge;
- deterministic test hooks;
- Playwright verification;
- Gauntlet evidence layout;
- quality-profile configuration.

From there the primary interface is intent:

> Build a third-person exploration game in a flooded industrial district. The player should restore three substations while avoiding autonomous maintenance machines. I will provide reference images for the hero vehicle and substations.

The Game Studio Director turns that request into routed capabilities and settlement units rather than one undifferentiated code-generation task.

---

# A representative journey

Suppose the player needs to restore an old radio transmitter.

### 1. The game requires a specific transmitter

The user provides reference photos.

The studio identifies:

```text
asset.reconstruct.reference-image
```

and routes it to img2threejs.

### 2. img2threejs reconstructs it

The result remains Three.js-native and exposes useful structural affordances such as named nodes, pivots, sockets, or colliders when available.

The studio normalizes that result into an `AssetRecord`.

### 3. Gameplay binds meaning

Koota does not infer gameplay from the mesh.

The game explicitly binds:

```text
power_switch  → interaction
tuning_knob   → frequency state
antenna       → visual/interaction projection
```

### 4. The scene provides consequence

3dviz composes the surrounding relay room. Needle/Three renders it. Rapier owns physical interaction. BVH accelerates aiming or interaction queries.

### 5. Verification runs

Playwright loads `transceiver-interaction`, performs the input sequence, and captures:

```text
state
  transmitter.powered == true
  objective.relayRestored == true

pixels
  powered indicator visibly changes
  relevant interaction remains readable

telemetry
  frame budget holds
  no runtime errors
```

### 6. Gauntlet decides

If all required consequences close, the increment settles.

If the pixels show a lit transmitter but authoritative state still says `powered == false`, the requirement fails regardless of appearance.

That is the studio in miniature.

---

# Reference game: Blackwater Relay

The repository includes **Blackwater Relay**, a small production-shaped third-person vertical slice designed to exercise the entire studio.

The player drives a rover across a storm-dusk island relay outpost, recovers a power cell, opens the relay gate, encounters a patrolling service drone, operates a field transceiver reconstructed from a project-owned reference image, and activates the beacon.

It covers:

- 3dviz environment composition;
- seeded terrain;
- reference-image reconstruction through img2threejs;
- provenanced sourced PBR/HDRI content;
- Needle + Three.js;
- Koota authoritative state;
- Rapier physics;
- Recast navigation;
- BVH spatial queries;
- Quarks VFX;
- Tone.js audio;
- DOM/CSS UI;
- a deliberately justified Blender animation-retarget/bake escalation;
- glTF optimization;
- agent-browser exploration;
- Playwright deterministic proof;
- state + pixel + telemetry Gauntlet settlement.

Named scenarios include:

```text
boot
active-play
transceiver-interaction
patrol-obstacle
beacon-activation
performance-flythrough
```

Blackwater Relay is not the product of the studio. It is the conformance game that proves the pieces can coexist.

---

# Evidence

Every settlement-critical observation is run-scoped.

```text
artifacts/runs/<run-id>/
├── manifest.json
├── scenario.json
├── state-before.json
├── state-after.json
├── metrics.json
├── console.json
├── network.json
├── screenshots/
├── video/
├── playwright-trace/
└── asset-evidence/
```

The manifest binds evidence to:

- project;
- project revision;
- requirement IDs;
- scenario;
- seed where applicable;
- browser;
- viewport;
- quality profile;
- studio/provider revisions;
- artifact hashes;
- result.

Historical evidence cannot silently satisfy a new game revision.

Failed evidence is retained.

---

# Performance is part of correctness

A beautiful browser game running at an unacceptable frame time has not satisfied its target.

Every game defines its own quality profiles, for example:

```text
desktop-high
mobile-medium
```

The studio verifies metrics relevant to those profiles, including at minimum:

- frame time distribution;
- FPS;
- draw calls;
- triangles;
- texture/resource counts;
- load/readiness time;
- browser/runtime errors.

Projects may add GPU timing, memory, network, streaming, or other metrics.

There is no universal "AAA" triangle count or draw-call target. The quality profile is part of the game specification and is frozen before it can become an acceptance gate.

---

# Provenance and external assets

External content is untrusted until it is admitted through the asset pipeline.

The studio prefers, in order appropriate to the job:

1. user-provided material;
2. already accepted project assets;
3. approved project-owned or licensed references;
4. suitable CC0/licensed assets;
5. inspectable procedural construction;
6. specialist generation or Blender where justified;
7. optional generic generation where project policy permits it.

Reference images used to guide reconstruction are tracked separately from source material actually shipped in the game.

Provider credentials never enter browser bundles, public manifests, or evidence.

Unknown provenance blocks production acceptance.

---

# Extending the studio

A new provider should not require changing game semantics.

To add one:

1. identify the existing stable capability it satisfies, or define a new capability only if the distinction is real;
2. implement the appropriate adapter kind;
3. normalize results into studio contracts;
4. declare positive and negative routing affordances;
5. define provider preflight;
6. define proof requirements;
7. add routing collision tests;
8. add failure/recovery tests;
9. prove one real target integration before treating the provider as accepted.

Provider adapter kinds include:

```text
agent_skill
package
cli_dcc
http_source
browser
```

The adapter is deliberately thin. Upstream tools remain responsible for their specialist implementation.

---

# Source ownership and forks

Gauntlet Game Studio minimizes source ownership.

Normal runtime libraries are pinned package dependencies.

Agent-facing upstream repositories whose skills need inspection are pinned under `vendor/`.

The preferred order of modification is:

```text
configuration
    ↓
adapter
    ↓
skill overlay
    ↓
minimal patch
    ↓
narrow fork
```

A whole upstream project is not forked merely because changing it would be convenient.

If a specialist skill must diverge, only that skill is copied under:

```text
skills/vendor-overrides/<upstream>/<skill>/
```

with metadata recording:

- upstream repository;
- upstream commit;
- reason for divergence;
- changed files;
- rebase/compatibility test.

---

# Failure behavior

The studio fails visibly.

Examples:

**Missing user/reference image**

A request to reconstruct a particular object is blocked or asks for an approved reference. It does not silently become text-to-3D.

**Duplicate Three.js runtime**

`studio doctor` fails compatibility checks. The adapter is not allowed to create a second hidden `three` object universe.

**Provider unavailable**

The capability stays the same. The router may select an explicitly eligible equivalent provider or report a blocked capability.

**Asset exceeds budget**

The asset remains pending/rejected while optimization, LOD, compression, instancing, simplification, or a representation change is attempted.

**Required browser proof unavailable**

The test is skipped/blocked—not passed.

**Visual and semantic evidence disagree**

The requirement remains unsettled.

These failure boundaries are part of the product.

---

# Where authority lives

The repository deliberately separates desired state, execution state, implementation, and proof.

```text
AGENTS.md
    durable operating rules for coding agents

.agents/specs/
    normative desired state

.agents/plans/
    dependency-ordered settlement graph

.agents/CURRENT_STATUS.yml
    mutable operational projection

source + tests
    implementation

artifacts/runs/
    observed evidence
```

`CURRENT_STATUS.yml` does not redefine the specification.

A plan does not silently rewrite a normative requirement.

A README does not prove that implementation exists.

Evidence decides what is settled.

---

# For coding agents

Before substantial work:

1. read `AGENTS.md`;
2. read `.agents/CURRENT_STATUS.yml`;
3. read the governing specification;
4. read the active development plan;
5. inspect the relevant source, tests, configuration, and evidence;
6. load detailed provider skills only after the capability has been selected.

Do not infer progress from this README. This README describes the system's intended stable operating model; current settlement lives in `.agents/CURRENT_STATUS.yml`.

---

# License

See [`LICENSE`](./LICENSE).
