# AGENTS.md

Durable operating contract for coding agents in Gauntlet Game Studio. Keep this file project-specific, behavior-changing, and earned. Detailed execution state belongs in `.agents/CURRENT_STATUS.yml`; normative requirements belong in `.agents/specs/`; implementation settlement graphs belong in `.agents/plans/`; detailed subsystem guidance belongs in scoped instructions near the affected code.

## 1. Start here

Before substantial work:

1. Read this file.
2. Read `.agents/CURRENT_STATUS.yml`.
3. Read the governing spec under `.agents/specs/`.
4. Read the active plan under `.agents/plans/`.
5. Inspect the affected code, tests, configuration, and current evidence.
6. Read the nearest scoped `AGENTS.md` if the target subtree has one.

Do not infer current progress from chat history, README prose, or task numbering when the status file and repository evidence are available.

## 2. Instruction and artifact authority

Instruction precedence:

1. Runtime/system safety and explicit user constraints.
2. Nearest applicable scoped `AGENTS.md`.
3. This root `AGENTS.md`.

Artifact authority is separate from instruction precedence:

- Approved spec = normative desired state: what MUST be true.
- Active plan = dependency/settlement graph projected from the spec.
- `.agents/CURRENT_STATUS.yml` = mutable operational projection only.
- Code, tests, and evidence = observed implementation state.

A plan MUST NOT silently rewrite the spec. If implementation evidence contradicts the spec or exposes ambiguity, block the affected work and revise the governing artifact explicitly.

## 3. Execute by settlement, not activity

- Follow the active plan DAG by true dependency, not narrative order.
- A task is complete only when its declared gate, teeth/falsification checks, evidence, and required confirmation pass.
- P2/P3 preregistration MUST exist before evaluating the evidence it is meant to constrain.
- P3 work requires fresh independent/adversarial confirmation.
- Preserve failed, contradictory, and correction evidence; later success does not erase earlier consequence.
- Never weaken acceptance criteria merely because an implementation fails them.
- Update `.agents/CURRENT_STATUS.yml` only to reflect observed execution state, settled evidence, blockers, and next-ready work.
- Update Grafter context.md if there is meaningful change in the codebase.

## 4. Core architecture invariants

- Route by stable capability first; select/load provider-specific detail only after the required capability is identified.
- Keep provider choice below stable studio contracts. Do not make vendor nouns part of domain semantics unless the spec requires them.
- Prefer adapters, overlays, configuration, and minimal patches before forks.
- Do not fork an upstream project merely to simplify local invocation.
- Runtime libraries belong as pinned package dependencies unless their source or agent-facing skill content must be inspected or adapted.
- Agent-facing upstream projects may be pinned subrepos when needed; preserve upstream provenance and revision.
- The studio is semantic glue, not a replacement engine or DCC.

## 5. Representation and authority rules

- Authoritative gameplay state MUST remain separate from Three.js/Needle scene objects, Rapier bodies, Recast data, Blender objects, and other execution projections.
- The project runtime MUST resolve one authoritative Three.js dependency graph. Do not introduce hidden duplicate `three` installations.
- Provider success does not equal studio success; normalize output into studio contracts before downstream reliance.
- Every production asset requires an `AssetRecord` with provenance, route, runtime representation, applicable budgets, and acceptance state.
- User-provided references, reference-only external imagery, and shipped source assets are distinct provenance classes and must remain distinguishable.

## 6. Capability routing boundaries

- `img2threejs`: use for reconstructing a specific depicted object or character when suitable reference imagery exists. Do not use it as generic text-to-3D, terrain, or environment generation.
- `3dviz-pro-max`: use for scene/world composition, architecture, vegetation, lighting, atmosphere, and environment construction.
- Terrain generation, navigation, physics, spatial queries, VFX, audio, asset sourcing, and optimization remain separate capabilities even when composed into one scene.
- Blender is an escalation path for work that materially needs DCC capabilities such as topology, UVs, baking, difficult rigging/skinning, retargeting, or mesh cleanup. It is not the default authoring environment and never owns game semantics.
- `threejs-game-skills` specialist knowledge may be reused, but Gauntlet Game Studio owns routing policy. Do not expose an upstream director as competing orchestration authority.
- Exploratory browser automation and deterministic proof are separate roles: agent-browser may explore; Playwright or the plan-declared proof harness settles browser behavior.

## 7. Skill and tool descriptions

Descriptions live in agent context; optimize them for routing discrimination.

- State what the capability does.
- State the primary trigger for using it.
- State the nearest important “do not use” boundary when ambiguity is plausible.
- Prefer 200–400 characters; 120–500 is acceptable; never exceed the platform/spec limit.
- Keep commands, edge cases, long workflows, and provider detail inside the activated skill or references.
- Do not load many specialist skills “just in case.” Progressive disclosure is part of the architecture.

## 8. Observability and Gauntlet proof

Settlement-critical behavior is observed through the channels material to the claim:

- state: authoritative semantic/game truth;
- pixels: visible rendered consequence;
- telemetry: runtime/performance consequence.

Do not infer one channel from another. A visually plausible result can still fail semantic or performance settlement.

Development/test observability surfaces must be stable enough for deterministic automation and must not leak privileged debug mutation into production.

## 9. Verification discipline

- Use the exact task-local gates declared by the active plan.
- Reuse repository-native validation commands; do not create competing gate surfaces without a requirement.
- If a declared gate command does not exist yet, treat that as task scope only when the task is responsible for creating it; otherwise surface a blocker.
- Performance is a first-class constraint from the first representative playable scene.
- Required skipped integrations are skipped, not passed.
- Claims must not exceed what the evidence actually observes.

## 10. Repository hygiene

- Keep the root `AGENTS.md` under 150 lines and well below 32 KiB.
- Add scoped `AGENTS.md` files only where a subtree needs behavior-changing guidance that does not belong here.
- Never place secrets, credentials, mutable task state, provider tokens, or machine-specific values in `AGENTS.md`.
- Do not turn this file into a README, architecture manual, skill catalog, plan, methodology guide, or wishlist.
- Avoid duplicating detailed guidance already governed by specs, plans, schemas, or scoped docs.
- Generated/build artifacts and evidence must stay in their declared project locations; do not commit incidental tool output.

## 11. Change discipline

Before changing architecture, schemas, routing, authority boundaries, or provider ownership:

1. Identify the governing requirement IDs.
2. Confirm the active task actually settles them.
3. Inspect existing representations before adding a parallel abstraction.
4. Make the smallest coherent change that preserves project invariants.
5. Run the task’s falsification checks and applicable global gates.
6. Record evidence and update status only after consequence is observed.

If a discovery invalidates the representation rather than the implementation, stop patching locally and trigger the plan’s redesign/correction protocol.

## 12. Investigation and Retrieval

Discover before asking; ask before inventing. Settle mechanically answerable questions with tools before spending model reasoning.

Use the cheapest tool that can settle the question:

* `graft map` for initial repository orientation.
* `graft ask "<question>" --source` for ranked architectural/behavioral context with source spans.
* `graft callers <symbol>` (`--direction out`, `--depth N`) for call graph and blast radius.
* `graft skeleton <file>` for signatures/spans without whole-file reads.
* `graft grep "<literal>"` for exhaustive indexed literal matches.
* `zvec_grep_search` or `zg` for semantic/conceptual discovery when wording or location is unknown.
* `rg --files` for inventory and `rg` for known paths, symbols, literals, config keys, errors, or regexes.
* `rust-analyzer` for Rust structural/semantic questions before grep-and-recompile loops.
* `$understand-chat`, `$understand-explain`, or `$understand-diff` only when relationships/blast radius require broad reading; verify against source/tests.

Use Graft/zvec to narrow, then verify anchors with `rg` and read only relevant ranges. If Graft truncates a span, open that exact range before finalizing.

Do not invent product behavior, acceptance criteria, comparison standards, public API semantics, security policy, or domain decisions. Record unresolved uncertainty as fog rather than guessing.

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
