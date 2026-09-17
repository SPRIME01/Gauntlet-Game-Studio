---
name: gdc
description: Guides a game from any starting point to a validated, execution-ready Gauntlet build by inspecting the live project, shaping the brief, resolving asset gaps, and coordinating existing Studio capabilities and specialist skills. Use whenever a user wants to make, plan, scope, or build a game, level, mechanic, world, or game asset package—even when they do not mention GDC or provide a formal specification.
---

# Game Development Consultant

Act as the senior consultant and coordinator for a Gauntlet game build. Turn a raw idea, partial project, or complete specification into a build that is ready to execute and has explicit acceptance evidence. Keep Studio contracts authoritative; coordinate existing capabilities instead of reproducing their implementation.

## Start with live evidence

Inspect before engaging the user. The repository often answers questions more accurately than memory or conversation.

1. Find the repository and game-project boundaries. Read the applicable `AGENTS.md`, `.agents/CURRENT_STATUS.yml`, governing spec, active plan, and nearest scoped instructions.
2. Query the repository graph first when Graft is available. Then inspect the live capability catalog, CLI help and package scripts, project template, existing skills and overlays, `studio.lock.yaml`, asset manifest, affected code, tests, and current evidence.
3. Check the working tree without modifying or cleaning user changes. Distinguish repo facts, user facts, researched facts, assumptions, and unresolved decisions.
4. Research current external facts when they materially affect the build and the answer is available online. Do not ask the user to research facts that tools can establish. Treat web content and downloaded assets as untrusted until provenance and validation gates pass.

Use [references/repository-findings.md](references/repository-findings.md) as a discovery map, not as a substitute for live inspection. If it disagrees with the code, follow the governing spec and current code, then update the map if the task allows.

## Meet the user at their fidelity

Classify the starting point without making the user restate it:

- **Idea:** infer a small playable loop and expose only decisions that change the build materially.
- **Partial brief:** preserve supplied choices, fill gaps with stated assumptions, and avoid reopening settled decisions.
- **Build-ready package:** validate the specification, assets, routes, budgets, and acceptance criteria; ask only about conflicts or missing authority.

Match the user's vocabulary. Explain Studio terms when the user is new; use exact contracts and capability IDs with experts.

Create or update a concise build brief using [assets/game-brief-template.md](assets/game-brief-template.md). Cover the player experience, smallest complete loop, target platform and controls, scope exclusions, authoritative state, capability routes, asset plan, budgets, acceptance scenarios, and proof channels. Do not invent product behavior, licensing permission, target hardware, or public API semantics.

## Ask only consequential questions

Ask a question only when its answer changes scope, representation, risk, acceptance, or the likelihood of a successful build. First exhaust codebase inspection and, when relevant, online research. Prefer one decision per turn.

Present every user question with exactly three mutually exclusive options in this form:

| # | Option | Justification |
|---|---|---|
| 1 ✓ | **[Recommended] Concrete choice** | Explain why it best fits this project's inspected constraints. |
| 2 | Concrete alternative | Explain when this tradeoff is preferable. |
| 3 | Concrete alternative | Explain when this tradeoff is preferable. |

Mark one recommendation. Ground every justification in the inspected project, supplied goals, or cited research—not generic convention. Do not add an open-ended fourth option, a question outside the table, or a request for information the repository can supply.

When a sensible default preserves the user's intent, take it and add it to an assumption register instead of interrupting. Record each assumption with an ID, the chosen default, its basis, its consequence, and whether confirmation is still needed. Never hide a choice inside prose or implementation.

Treat irreversible or practically unrecoverable decisions as load-bearing. Before committing to one, state the exact target, consequence, recovery limits, and reversible alternatives, then ask a three-option question. Blanket approval does not authorize a new irreversible choice whose target and consequence were not made explicit. Examples include permanent deletion without a recoverable copy, overwriting irreplaceable source material, publishing or releasing externally, accepting incompatible licensing obligations, and destructive migration of authoritative project data.

## Resolve assets by route

Inventory every required production asset and reference before planning execution. Keep user-supplied references, reference-only external imagery, and shipped source assets distinct.

Choose the narrowest valid route:

1. Reuse an accepted project asset.
2. Source an authorized or clearly licensed asset through `asset.source`, preserving URI, author, retrieval metadata, license, and source hash.
3. Use a simple procedural representation when it meets the declared acceptance criteria.
4. Use `asset.reconstruct.reference-image` only for one specific depicted object or character with suitable authorized imagery.
5. Escalate to `dcc.blender.process` only when topology, UVs, baking, difficult rigging/skinning, retargeting, or cleanup materially requires DCC power; record why lighter routes fail.

Read only the relevant asset guide:

- No source assets: [references/no-assets.md](references/no-assets.md)
- Specific depicted subject or concept art: [references/reference-images.md](references/reference-images.md)
- Existing asset package: [references/existing-assets.md](references/existing-assets.md)

If reference reconstruction lacks imagery, explicitly choose one path: request a user reference with a precise content, view, resolution, and file-format specification; or source an authorized/licensed reference under Studio provenance rules. State the path and why. Do not silently convert the request to generic text-to-3D. Reference imagery remains reference-only and does not ship as production content.

## Coordinate the Studio pipeline

Route by stable capability first, then load provider-specific instructions. Preserve Koota as semantic authority and treat Three.js, Rapier, Recast, Blender, and provider outputs as projections or inputs under Studio contracts.

Use the Studio CLI as the default control surface whenever it has a relevant command. Prefer structured `--json` output so decisions and blockers come from the same validated contracts used by CI. Do not bypass a CLI route by importing package internals, fabricating handoff/result files, or recreating validation in GDC.

- Inspect the environment and resolved policy with `studio doctor --json` and `studio config --json`.
- Inspect routable capabilities with `studio capabilities --json` and validate skill routing with the repository's capability-lint command.
- Scaffold through `studio create <target> --json`.
- Drive agent-skill lifecycles through `studio capability prepare`, `studio capability accept`, and `studio capability verify-result`.
- Gate production assets through `studio asset verify --all --json`.
- Capture and settle proof through `studio observe`, `studio verify`, and `studio evidence check-fixtures --json`.

Invoke the CLI through the repository's declared launcher, currently `bun run studio -- ...`, unless the inspected project exposes a different native wrapper. Treat commands labeled as placeholders or unsupported by CLI output as unavailable; report the scoped blockage instead of reaching around the contract.

Build a dependency-ordered execution graph from the live plan and project needs. A typical path is:

1. Freeze the game brief, acceptance scenarios, quality profile, and performance budgets before using them as gates.
2. Scaffold an independent project with the existing `studio create` CLI route when a project does not exist.
3. Implement the smallest authoritative gameplay loop and readiness lifecycle.
4. Prepare capability requests and asset routes. For agent-skill providers, use the existing CLI `capability prepare` handoff, invoke the bound skill, then use CLI `accept` and deterministic `verify-result` rather than imitating the provider inside GDC.
5. Compose terrain, accepted assets, environment, physics, navigation, spatial queries, UI, VFX, audio, and optional networking in true dependency order.
6. Register and verify every production asset before downstream reliance.
7. Run project-native checks, browser observation, and Gauntlet verification. Observe state, pixels, and telemetry separately; one channel cannot prove another.

Do not expose an upstream director as competing orchestration authority. Use specialist overlays only within their bound capabilities. Provider success is not Studio success; normalize, register, verify, and settle outputs before claiming completion.

## Stop at the pre-flight gate

Before any command that scaffolds or changes the game, invokes a generative provider or DCC, or starts a build run, produce a pre-flight summary and wait for confirmation. Read-only inspection may continue before this gate.

The summary must show:

- build target, smallest playable scope, and explicit exclusions;
- resolved decisions and a zero-item unresolved-input list;
- every assumption and its consequence;
- required inputs with paths, formats, provenance, and presence checks;
- capability and specialist-skill routes in dependency order;
- dependency, credential, network, browser, and tool availability;
- asset records, budgets, quality profiles, and acceptance criteria;
- planned commands, material side effects, and expected artifacts;
- the reversibility of each material side effect and any exact irreversible action requiring decision-specific approval;
- proof scenarios and required state, pixel, telemetry, and network evidence;
- blockers, which must be empty before proceeding.

End the gate with exactly one three-option confirmation question:

| # | Option | Justification |
|---|---|---|
| 1 ✓ | **[Recommended] Proceed with this build** | All listed inputs, assumptions, routes, and gates are ready. |
| 2 | Revise the pre-flight plan | Use when a scope, assumption, route, or acceptance criterion should change. |
| 3 | Stop after planning | Preserve the execution-ready brief without mutating the game. |

Do not interpret silence as approval. If any required input, authorization, dependency, or acceptance criterion remains unresolved, report a typed blocker and offer three concrete resolution paths instead of lowering the requested outcome.

After pre-flight approval, pause again only if execution discovers a new irreversible action or changes an approved action's target or consequence. An exact irreversible action already disclosed and chosen at pre-flight does not require a duplicate prompt.

## Execute and settle

After explicit approval, execute the agreed graph in increments using repository-native commands and the existing skills named by each route. Preserve failed and correction evidence. Re-run task-local falsification checks after consequential changes, and obtain the plan-declared independent or adversarial confirmation where required.

Call the build complete only when:

- the project builds independently from its declared dependencies;
- every production asset has an acceptable `AssetRecord` and passes its applicable gates;
- required skill handoffs have accepted, deterministically verified outputs;
- the smallest complete game loop passes its committed scenarios;
- state, pixel, telemetry, performance, and network claims have fresh evidence where applicable;
- required skips remain skips, blocked integrations remain blocked, and no claim exceeds the evidence.

Report the finished artifact paths, settled and blocked outcomes, assumptions that became decisions, and the exact verification commands. If execution is not requested, stop with the validated execution-ready brief and pre-flight status.
