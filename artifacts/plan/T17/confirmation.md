# T17 Independent Adversarial Confirmation Record

- **Confirmation mode**: independent_adversarial (per plan T17 preregistration)
- **Confirmed at**: 2026-09-16 (fresh verifier session; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM**
- **Scope**: REQ-BIND-009, REQ-BIND-012, REQ-AUDIO-001, REQ-AUDIO-002, REQ-AUDIO-003, REQ-SAFE-007

## Gates reproduced fresh (verifier's own runs, exit 0)
- `bun test packages/runtime/test/audio-headless.test.ts` — 6/6; vfx-quarks + ui-hud 9/9
- `bun run test:audio-browser` — exit 0 (system Chrome; details below)
- `just check`/`just test` (238/238)/`just lint`/`just validate-agent-artifacts`; `third-party:verify`;
  `runtime:headless-smoke` and `network:headless-smoke` both green with the audio module in the package

## Adversarial findings (all attacks failed)
1. Autoplay bypass: no `--autoplay-policy` flag anywhere; Chrome spawned directly with minimal flags and
   Playwright only `connectOverCDP`s afterward, so it cannot inject launch flags. Fresh rerun observed Phase 1
   with `hasBeenActive:false`, un-gestured `unlock()` leaving backend/context `suspended`, heartbeat ticking,
   playSound suppressed; attach alone did not unlock; only the trusted click reached `ready/running` with
   `intents_played:1`. The raw-CDP-before-Playwright-attach design is real (run.ts order verified).
2. Headless purity: zero Tone/Web Audio imports in packages/runtime (structural test enforces, including a
   runtime→adapters import ban); tone module deliberately not re-exported from the adapters index; NullAudioBackend
   imports nothing; both headless smokes green.
3. Semantic purity: AudioProjectionHandle and effect intents are pure data; one-way VFX sync with stable-ID
   ProjectionRegistry correlation; no back-propagation; pre-existing Koota provider-object guard passes.
4. Failure containment: permanently-locked + throwing backend — simulation completed, all intents suppressed;
   browser playSound-while-locked returns a dead handle with suppression counted.
5. Content licensing: zero audio sample files anywhere; tone backend is synth-only; Tone.js MIT attribution kept
   separate.

## Prereg discipline
Prereg frozen before implementation (mtimes verified); both falsifiers freshly reproduced; the runner's exit-2
scoped-blockage path exists and triggers if a future environment pre-grants activation.

## Recorded non-blocking observation
summary.md/teeth.txt wording says the two headless smokes ran "with the new audio module inside the runtime import
graph"; the smoke entry scripts do not transitively import src/audio. The substantive headless-independence leg is
genuinely proven by the dedicated TEETH-T17-002 test importing the full runtime index and running a complete Koota
kernel simulation headless. Wording imprecision only.
