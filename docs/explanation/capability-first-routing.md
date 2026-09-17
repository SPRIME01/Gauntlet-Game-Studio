# Architectural Explanation: Capability-First Routing

This document explains why Gauntlet Game Studio decouples domain game requirements from vendor tool nouns, why capability descriptors require explicit negative affordances, and how progressive disclosure protects coding agent context windows from cognitive overload.

---

## 1. The Problem with Vendor Nouns in Agent Prompts

When software architectures expose vendor-specific names directly to coding agents:
```text
Agent Instruction: "Use img2threejs to build the level, then use threejs-game-director to coordinate Blender and three.terrain.js."
```
Several structural failure modes emerge:
1. **Tool Overuse**: An agent instructed to use `img2threejs` will attempt to use it for everything—including terrain heightfields, buildings, skyboxes, and whole levels—even though it is specialized for single depicted props.
2. **Competing Orchestration Authorities**: Bringing in specialized skill packages (like `threejs-game-skills`) often brings competing director prompts (`threejs-game-director`) that attempt to re-plan the monorepo architecture, fighting the studio's settlement graph.
3. **Fragile Coupling**: If an upstream library is updated, renamed, or replaced (e.g. replacing `three.terrain.js` with deterministic mathematical elevation), all prompt templates and agent workflows break.

---

## 2. Capability-First Architecture

Gauntlet Game Studio strictly enforces **capability-first routing**:
```text
Game Intent ──► Stable Studio Capability ──► Provider Selection ──► Agent Handoff
```

### Studio Contracts are Vendor-Neutral
In [`packages/contracts/src/schemas.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/contracts/src/schemas.ts), the `CapabilityRequest` schema forbids provider-specific nouns. The admitted request represents domain work:
```json
{
  "id": "req-rover-prop",
  "project_id": "blackwater-relay",
  "capability_id": "asset.reconstruct",
  "intent": "Reconstruct rugged Mars-style rover chassis from reference photo",
  "acceptance": ["polycount <= 2500", "exposes wheel sockets"]
}
```

Only after the request is validated does the studio router select a provider from the capability's declared list of approved providers.

---

## 3. Negative Affordances: Guarding the Boundaries

In LLM-driven development, defining what a tool *can* do is insufficient. Language models readily hallucinate analogical uses for powerful tools unless explicitly constrained.

Every `CapabilityDescriptor` in [`CAPABILITY_CATALOG`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/capabilities/catalog.ts) must declare explicit **negative affordances** (`do_not_use_when`):

```typescript
{
  id: "asset.reconstruct",
  summary: "Reconstruct a specific depicted object or character into procedural Three.js...",
  use_when: [
    "reconstructing a depicted object from reference image",
    "character model from reference photo"
  ],
  do_not_use_when: [
    "generic text-to-3D without reference image",
    "scene composition",
    "world environment layout",
    "procedural terrain"
  ]
}
```

When [`routeCapability()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/router/router.ts) matches intent strings, it evaluates both positive triggers and negative boundaries:
- If a request says "create a canyon environment with an old radio", the presence of "environment" triggers the negative affordance on `asset.reconstruct`, preventing the router from misdirecting level composition into a single-prop modeler.

---

## 4. Progressive Disclosure of Agent Skills

A full agentic studio may include dozens of specialist skills: particle designers, procedural audio generators, shader authors, DCC scripts, and test harnesses.

Loading all skill instructions into the LLM's system prompt immediately consumes 30,000+ tokens of context, degrades reasoning performance, and increases tool hallucinations.

Gauntlet Game Studio uses **progressive disclosure**:
1. **Routing Phase**: The agent loads only the lightweight catalog (summaries under 400 characters).
2. **Selection Phase**: Once `asset.reconstruct` is selected, only the `img2threejs` handoff instructions are disclosed to the agent.
3. **Execution Phase**: The agent executes the narrow task and produces normalized output artifacts.
4. **Settlement Phase**: The handoff is closed, context is unloaded, and Gauntlet evaluates the evidence.

---

## 5. Architectural Consequences & Trade-Offs

### Consequences
- **Upstream Tool Independence**: Third-party skills can be updated in `vendor/` or replaced without altering game specifications or runtime APIs.
- **Controlled Orchestration**: The Game Studio Director remains the sole orchestration authority. Competing upstream directors are blocked by [`SkillOverlayPolicy`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/skills/overlay.ts).

### Trade-Offs
- Requires maintaining explicit capability schemas and catalog definitions in `@gauntlet/contracts` and `@gauntlet/studio`.
- Intent routing requires deterministic keyword and boundary matching logic in `router.ts`.

---

## 6. Source Trail

- **Capability Descriptor Schema**: [`packages/contracts/src/schemas.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/contracts/src/schemas.ts#L20)
- **Normative Catalog**: [`packages/studio/src/capabilities/catalog.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/capabilities/catalog.ts)
- **Capability Router**: [`packages/studio/src/router/router.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/router/router.ts)
- **Skill Overlay Policy**: [`packages/studio/src/skills/overlay.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/skills/overlay.ts)
- **Skill Metadata Linter**: [`packages/studio/src/skills/linter.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/skills/linter.ts)
- **Router Tests**: [`packages/studio/test/capabilities/router.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/test/capabilities/router.test.ts)
