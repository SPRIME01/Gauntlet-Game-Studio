# Tutorial: Creating Your First Game Project

This tutorial walks you through scaffolding, running, and inspecting an independent 3D browser game using Gauntlet Game Studio. You will create a project outside the studio monorepo, verify its health, run its local development server, and inspect its runtime state.

---

## Prerequisites
- **Bun** `>= 1.4.0` installed on your machine (`bun --version`).
- Terminal access to the root of the `gauntlet-game-studio` repository.

---

## Step 1: Verify Studio Environment Health

Before generating a game, run the studio doctor preflight diagnostic to verify that your environment satisfies all baseline requirements:

```bash
bun run studio -- doctor
```

**Expected Output**:
```text
=== Gauntlet Studio Doctor (v0.3.0) ===
 ✓ [bun_version] Bun satisfies baseline (>= 1.4.0)
 ✓ [donor_isolation_gitignore] .tmp/ is properly gitignored
 ✓ [donor_dependency_check] Zero donor dependencies detected
 ✓ [configuration_integrity] Configuration parsed cleanly
 ✓ [workspace_packages] All 5 required workspace packages present

Overall Status: SUCCESS
```

---

## Step 2: Scaffold the New Game Project

Use `studio create` to instantiate a new game project. We will create a project named `mars-outpost` in a sibling directory:

```bash
bun run studio -- create ../mars-outpost --name mars-outpost
```

**Expected Output**:
```text
[create] Creating game project 'mars-outpost' at /path/to/mars-outpost...
[create] Copied template files from templates/game
[create] Generated studio.lock.yaml with pinned studio dependencies
[create] Project initialized successfully.
```

---

## Step 3: Enter the Game and Inspect the Project Layout

Navigate into your newly created game:

```bash
cd ../mars-outpost
ls -la
```

Notice the clean, independent project structure:
```text
mars-outpost/
├── .agents/              # Agent operating instructions & game spec
│   └── specs/
│       └── game.spec.yaml
├── assets/               # Production asset manifest & models
│   └── manifest.json
├── src/                  # Game source code
│   ├── index.ts          # Browser bootstrap entrypoint
│   └── game/             # Core logic & systems
├── tests/                # Automated headless test suite
│   └── game.test.ts
├── package.json          # Independent project manifest
├── studio.lock.yaml      # Pinned studio & provider revisions
├── tsconfig.json         # TypeScript configuration
└── AGENTS.md             # Project-specific agent rules
```

Verify that the game's manifest dependencies resolve cleanly:
```bash
bun install
```

---

## Step 4: Run the Headless Test Suite

Run the game's built-in headless test suite:

```bash
bun test
```

**Expected Output**:
```text
bun test v1.4.0
tests/game.test.ts:
  ✓ Game Kernel > initializes SubsystemBarrier cleanly
  ✓ Game Kernel > advances fixed simulation ticks without DOM leaks
  ✓ Game Kernel > captures valid semantic state snapshot

 3 pass
 0 fail
```
*Notice: This test suite executed hundreds of ticks in milliseconds without spinning up a browser, proving headless simulation purity.*

---

## Step 5: Start the Development Server & Inspect the Observability Bridge

Start the local development server:

```bash
bun run dev
```

1. Open your browser to `http://localhost:3000`.
2. You will see the starter 3D viewport rendering procedural terrain and an initial rover actor.
3. Open the browser developer tools console (`F12` or `Cmd+Option+I`).
4. Type:
   ```javascript
   window.__GAUNTLET_STUDIO_OBS__
   ```
5. Inspect the live runtime surface:
   - Check readiness:
     ```javascript
     window.__GAUNTLET_STUDIO_OBS__.readiness()
     // Output: { state: "ready", required_subsystems: [...], ... }
     ```
   - Query entities:
     ```javascript
     window.__GAUNTLET_STUDIO_OBS__.entities.query("player")
     ```
   - Pause and step the simulation:
     ```javascript
     window.__GAUNTLET_STUDIO_OBS__.control.pause()
     window.__GAUNTLET_STUDIO_OBS__.control.step(60) // Advance exactly 1 second
     window.__GAUNTLET_STUDIO_OBS__.control.resume()
     ```

---

## Conclusion & Next Steps

You have successfully created, verified, and run an independent game project using Gauntlet Game Studio.

**Next Steps**:
- Read [Tutorial: Adding & Settling a Gameplay Scenario](file:///home/sprime01/projects/gauntlet-game-studio/docs/tutorials/adding-and-settling-a-scenario.md) to learn how to define frozen expectations and settle them with Gauntlet evidence.
- Read [Subsystem Guide: Runtime](file:///home/sprime01/projects/gauntlet-game-studio/docs/subsystems/runtime.md) to understand how to write Koota ECS systems.
