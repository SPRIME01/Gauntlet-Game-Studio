# Task Settlement Evidence: T17

## Task Information
- **Task ID**: `T17`
- **Title**: Integrate Quarks VFX, Tone audio boundary, and DOM UI
- **Proof Level**: `P3`
- **Confirmation**: `independent_adversarial` — PENDING (verifier receives source requirements, frozen prereg, implementation, fresh evidence, and the exact confirmation question; builder conclusions are non-authoritative context)
- **Settles**: `REQ-BIND-009`, `REQ-BIND-012`, `REQ-AUDIO-001`, `REQ-AUDIO-002`, `REQ-AUDIO-003`, `REQ-SAFE-007`
- **Timestamp**: 2026-09-16T04:20:00Z
- **Preregistration**: `.agents/preregistrations/gauntlet-game-studio-plan-T17.prereg.yaml` (frozen before implementation and before any evidence evaluation)

## Implementation Overview
1. **AudioBackend abstraction** (`packages/runtime/src/audio/backend.ts`): studio-owned
   contract with explicit lifecycle state `locked | suspended | ready` and `isHeadless()`.
   All payloads are pure data (`AudioEventIntent`, `AudioPlaybackHandle`,
   `AudioBackendDiagnostics`) — no Tone/AudioContext/Web Audio objects can cross the
   boundary structurally (REQ-BIND-012; the plan's redesign_trigger is enforced by
   interface shape). `playSound()` is contractually non-throwing: unavailable/locked audio
   suppresses the intent and returns a dead handle (REQ-SAFE-007).
2. **NullAudioBackend** (`packages/runtime/src/audio/null-backend.ts`): the mandatory
   headless/server/test backend. ZERO imports of any kind — no Web Audio, no Tone.js.
   Counted no-op playback with one-shot microtask completion; `is_headless: true`;
   honest bounded diagnostics (REQ-BIND-012, REQ-AUDIO-002, REQ-SAFE-007).
3. **AudioSystem semantic glue** (`packages/runtime/src/audio/audio-system.ts`): the single
   interaction point for core semantics. Drains the Koota `AudioProjectionHandle` trait
   (existing T08 trait) one-way into backend intents and marks consumption back in
   authoritative state; records a bounded pure-data event log correlated with ticks;
   `emitSound()` additionally survives a hostile backend whose `playSound()` throws.
   `registerAudioSubsystem()` binds the OPTIONAL "audio" subsystem to the `SubsystemBarrier`
   — readiness never depends on audio.
4. **Tone.js browser backend** (`packages/adapters/src/audio/tone/tone-backend.ts`):
   implements the runtime abstraction with the explicit lifecycle
   `locked` (no context requested) → `suspended` (context exists, not running) → `ready`
   (context running, reached ONLY through `unlock()` invoked inside a real user-gesture
   handler). `unlock()` returns the OBSERVED state within a bounded 400 ms window (an
   un-gestured Chrome `resume()` stays pending forever — the backend reports reality, never
   optimism). Pure-data `ToneSynthSoundSpec` registry; sounds are synthesized locally —
   **no audio content ships with the adapter; sample licensing is deliberately NOT inferred
   from Tone.js licensing (REQ-AUDIO-003)**. Browser-only entry: the adapters package index
   deliberately does NOT re-export the tone module, so nothing headless can instantiate
   Tone.js through normal imports.
5. **three.quarks VFX projection** (`packages/adapters/src/vfx/quarks/`): `QuarksVfxProjection`
   integrates three.quarks (REQ-BIND-009) strictly as an execution projection — pure-data
   `EffectSpawnIntent` in, three.quarks objects only inside; stable-ID correlation via the
   runtime `ProjectionRegistry`; one-way `syncFromState` (Koota Transform → emitter, never
   back); destroy/recreate without touching authority; unknown effect ids suppress+count
   instead of throwing. `defineBurstEffect()` builds deterministic burst effects from pure
   data. Headless-capable: `update(dt)` steps the batched renderer on CPU (no WebGL/DOM).
   Pinned `three.quarks@0.16.0` — verified on npm: 0.17.x requires three >=0.182.0;
   0.16.0 (peer three >=0.165.0) is the newest version compatible with the repo's three
   ^0.170.0. Single three installation verified (same ^0.170.0 range in both packages,
   one resolved 0.170.0 in the lockfile store).
6. **DOM/CSS HUD conventions** (`packages/runtime/src/ui/`): `HudModel` is authoritative
   HUD state as pure data (revision-counted, TTL messages, clamping, game-over) and is
   import-safe headless; `DomHudRenderer` is an opt-in DOM execution projection that throws
   `HudDomUnavailableError` instead of crashing when constructed without a DOM, renders
   one-way from model snapshots (revision-diffed), never writes back, and carries a
   first-party stylesheet (`HUD_BASE_CSS`, stable `.gauntlet-hud__*` conventions for
   specialist UI handoff). No DOM is required anywhere in the server path.
7. **Browser gesture-unlock proof** (`packages/adapters/test/audio-browser/`, root script
   `test:audio-browser`): Playwright 1.63.0 + real system Chrome
   (`/usr/bin/google-chrome`, Google Chrome 151.0.7922.75), zero autoplay-policy bypass
   flags (verified: none passed, and playwright-core 1.63.0 injects none — its only
   "autoplay" occurrence is an unrelated CDP permissions enum).
   - Phase 1 (TEETH-T17-001): the fixture tab is opened BY Chrome from its launch arguments
     and probed over a RAW CDP WebSocket before any Playwright attachment — observed
     `navigator.userActivation.hasBeenActive === false`, backend `locked`, context
     not-created. Un-gestured `unlock()` leaves backend `suspended`/context `suspended`
     while the game heartbeat keeps ticking and playSound yields a suppressed dead handle.
   - Phase 2: Playwright connects over CDP and performs a REAL trusted click; `unlock()`
     runs inside the gesture handler → backend `ready`, context `running`, one intent
     played, heartbeat unaffected.
   - Environment discovery (documented, reproducible): Playwright's own context/page
     attachment causes Chrome to grant the page sticky user activation, which would make
     the no-gesture leg unobservable. The attack leg therefore runs over raw CDP BEFORE
     Playwright attaches; this is an automation-artifact workaround, NOT a policy bypass.
     If a future environment shows pre-granted activation at Phase 1 (e.g. no display and
     a headless automation host that grants it), the runner exits **2 = scoped blockage**
     with precise evidence instead of faking a pass (REQ-AUDIO-001 conformance stays
     honest in every path).
8. **Dependencies added** (packages/adapters/package.json only): `tone@15.1.22` (exact),
   `three.quarks@0.16.0` (exact), `three@^0.170.0` (same range as runtime → single
   resolved version), `@gauntlet/runtime@workspace:*` (for the studio-owned abstraction),
   devDependencies `playwright@1.63.0` (browsers NOT downloaded — `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`;
   system Chrome is used) and `@types/three@^0.170.0`. tone/three.quarks were already
   pre-registered in THIRD_PARTY_NOTICES.md and vendor/attribution.json (T06); verified
   `third-party:verify` remains green.

## Verification Evidence
- **Narrow Gates** (fresh runs, exit 0 — `artifacts/plan/T17/gate.txt`):
  - `bun test packages/runtime/test/audio-headless.test.ts` — 6 pass / 0 fail
  - `bun test packages/adapters/test/vfx-quarks.test.ts` — 6 pass / 0 fail (headless, deterministic)
  - `bun test packages/runtime/test/ui-hud.test.ts` — 3 pass / 0 fail
  - `bun run test:audio-browser` — exit 0; Phase 1: locked→suspended under un-gestured
    attack with heartbeat unaffected; Phase 2: real click → ready/running, playback
    participates (`played=true intents_played=1`)
- **Teeth / Falsification Checks**: both preregistered falsifiers exercised fresh with
  PASS verdicts — `artifacts/plan/T17/teeth.txt`:
  - TEETH-T17-001: un-gestured unlock in real Chrome leaves audio explicitly
    locked/suspended; unrelated game logic kept ticking; playSound while locked suppressed
    (dead handle, intents_played=0). Only the real trusted click reached ready.
  - TEETH-T17-002: headless simulation (Koota + barrier + scheduler + semantic audio drain)
    runs green under Bun with `typeof document === "undefined"` and no
    `globalThis.AudioContext`; structural scan proves packages/runtime has zero Tone.js /
    AudioContext / @gauntlet/adapters imports and no `tone` dependency; T07
    `runtime:headless-smoke` and T12 `network:headless-smoke` (real Bun WebSocket headless
    server) re-ran green with the new audio module inside the runtime import graph.
- **Global Gates** (fresh runs, all exit 0): `just check`, `just test` (238 pass / 0 fail
  across 34 files, 1945 expects), `just lint`, `just validate-agent-artifacts`;
  `bun run third-party:verify` also green.

## Known limitations (not claimed)
- The browser proof runs headed (production-compatible) on this host because WSLg provides
  a display; on display-less hosts the runner attempts headless=new and, if that
  environment does not enforce/observe the gesture policy (Phase 1 pre-granted activation),
  it reports a scoped blockage (exit 2) rather than claiming a pass.
- ToneAudioBackend ships synth specs only (per REQ-AUDIO-003); no sampled content, no
  sample-loading pipeline, and no claim that any external audio content is production-safe.
- VFX proof covers deterministic CPU-side projection behavior (spawn/step/decay/correlate/
  destroy/recreate); GPU rendering appearance and visual throughput are NOT claimed (that
  is pixels/telemetry settlement territory for later representative-scene tasks).
- HUD conventions ship the state model + DOM renderer contract and CSS class conventions;
  full accessibility/localization behavior is explicitly out of scope per the plan
  ("does_not_prove").
- Playwright's attach-time activation grant is a documented upstream automation behavior;
  if a future Playwright release stops granting it, Phase 1's raw-CDP leg remains valid
  unchanged.

## Scope Notes
- New files: `packages/runtime/src/audio/{backend,null-backend,audio-system,index}.ts`,
  `packages/runtime/src/ui/{hud-state,dom-hud,index}.ts`,
  `packages/runtime/test/{audio-headless,ui-hud}.test.ts`,
  `packages/adapters/src/audio/{index.ts,tone/tone-backend.ts}`,
  `packages/adapters/src/vfx/{index.ts,quarks/{effect-intents,quarks-vfx,index}.ts}`,
  `packages/adapters/test/vfx-quarks.test.ts`,
  `packages/adapters/test/audio-browser/{run.ts,browser-entry.ts,unlock-fixture.html}`,
  `.agents/preregistrations/gauntlet-game-studio-plan-T17.prereg.yaml`,
  `artifacts/plan/T17/{gate.txt,teeth.txt,summary.md}`.
- Existing files touched, append-only: `packages/runtime/src/index.ts` (+2 export lines:
  audio, ui), `packages/adapters/src/index.ts` (+2 export lines: vfx, audio),
  `package.json` (+1 script line: `test:audio-browser`),
  `packages/adapters/package.json` (dependency additions only, listed above).
- No git commits; `.agents/CURRENT_STATUS.yml` untouched; `packages/runtime/src/observability/**`
  untouched (parallel builder owns it); no imports from `.tmp/donor`; Koota test worlds are
  explicitly released (`world.destroy()`) to respect koota's 16-world process cap.
