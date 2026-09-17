# GDC description evaluation

Status: complete — corpus approved by the user on 2026-09-17

Current description:

> Guides a game from any starting point to a validated, execution-ready Gauntlet build by inspecting the live project, shaping the brief, resolving asset gaps, and coordinating existing Studio capabilities and specialist skills. Use whenever a user wants to make, plan, scope, or build a game, level, mechanic, world, or game asset package—even when they do not mention GDC or provide a formal specification.

## Expected trigger queries

1. “I have an idea for a browser dungeon crawler but no design document or assets. Help me turn it into something playable.”
2. “Build the game described in our frozen spec and use the accepted asset manifest; I don’t want to revisit settled decisions.”
3. “Add a flooded observatory level to the existing game and prove it works within our current performance budget.”
4. “Our player needs a grappling-hook mechanic. Figure out the gameplay, physics, camera, and validation work needed to ship it.”
5. “I have front and side concept art for a specific robot enemy. Use it in the game and handle whatever asset pipeline steps are required.”
6. “We have no environment art yet. Work out how to source or create the minimum legal assets for the first playable build.”
7. “Turn this half-built single-player prototype into an authoritative two-player browser game and validate disconnect recovery.”
8. “Scope a small web game I can finish in two weeks, including the core loop, asset plan, and acceptance tests.”
9. “The game is mechanically complete but not release-ready. Take it through asset checks, browser proof, and the full verification suite.”
10. “Create a boss arena using the existing mechanics and assets, add only what is missing, and produce an execution-ready plan before building.”

## Expected non-trigger queries

1. “What are the best co-op games to buy this year?”
2. “Help me optimize my character build for the final boss in Elden Ring.”
3. “Analyze this chess position and recommend the strongest move.”
4. “Fix this null-reference exception in my Unity Animator controller.”
5. “Make a photorealistic Blender render of a telescope for a short film.”
6. “Build a product catalog website for a board-game store.”
7. “Run browser tests against our SaaS billing dashboard.”
8. “Explain entity-component-system architecture with a small pseudocode example.”
9. “Generate one transparent PNG potion icon; it is not tied to a game project yet.”
10. “Rewrite these tabletop rulebook paragraphs so they are easier to understand.”

## Assessment

The non-trigger set deliberately shares terms such as game, boss, Unity, Blender, browser, entity-component system, asset imagery, and rules. It distinguishes Gauntlet build coordination from game consumption, unrelated engines/toolchains, isolated media generation, general education, non-game web work, and tabletop prose editing.

The current description predicted all 20 expected outcomes correctly:

| Set | Expected | Predicted | Result |
|---|---:|---:|---|
| Trigger queries | 10 trigger | 10 trigger | 10/10 |
| Near-miss queries | 10 non-trigger | 10 non-trigger | 10/10 |
| Total | 20 | 20 | 20/20 |

### Trigger reasoning

The description explicitly covers making, planning, scoping, and building games, levels, mechanics, worlds, and asset packages. Its first sentence also covers validation and coordination. Those clauses directly match the idea, full-spec, level, mechanic, reference-asset, no-assets, multiplayer, scoping, release, and boss-arena queries.

### Non-trigger reasoning

The description requires work toward a Gauntlet game build. It therefore excludes purchasing advice, player strategy, chess play, work explicitly bound to Unity, standalone Blender media, non-game websites and browser tests, general ECS education, unattached single-image generation, and tabletop prose editing. Shared words such as “game,” “build,” “browser,” and “asset” do not overcome that outcome boundary.

### Decision

Keep the current description unchanged. It is pushy enough to capture implicit game-development requests, remains within the repository's 120–500-character convention at 406 characters, and correctly rejects all approved near-misses. A change would add words without improving the approved routing result.
