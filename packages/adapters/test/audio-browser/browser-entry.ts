/**
 * Browser entry for the T17 gesture-unlock proof.
 * Bundled with `bun build --target=browser` and served with the fixture page.
 *
 * This page wires the studio ToneAudioBackend exactly as a game would:
 * - a game-logic heartbeat (setInterval tick counter) completely independent of audio;
 * - an unlock attempt invoked OUTSIDE any user gesture (the TEETH-T17-001 attack);
 * - an unlock invoked INSIDE a real trusted click gesture handler.
 * No autoplay-policy bypass flags or hacks exist here.
 */

import { ToneAudioBackend } from "../../src/audio/tone/tone-backend";

declare global {
  interface Window {
    backend: ToneAudioBackend;
    game: { ticks: number; crashed: boolean };
    attemptUnlockWithoutGesture: () => Promise<string>;
    contextState: () => string;
  }
}

const backend = new ToneAudioBackend({
  sounds: {
    "ui.confirm": { kind: "synth", note: "C5", duration: "8n" },
  },
});
window.backend = backend;

// Unrelated game logic: must keep ticking regardless of audio state (REQ-SAFE-007).
window.game = { ticks: 0, crashed: false };
setInterval(() => {
  window.game.ticks++;
}, 8);

window.contextState = () => {
  try {
    return backend.getUnderlyingContextState();
  } catch {
    return "error";
  }
};

// TEETH-T17-001 attack helper: called from automation WITHOUT any user activation.
window.attemptUnlockWithoutGesture = async () => {
  try {
    return await backend.unlock();
  } catch (err) {
    window.game.crashed = true;
    return `threw:${String(err)}`;
  }
};

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// Real gesture path: trusted click -> unlock() -> play a sound.
const unlockButton = document.getElementById("unlock");
if (unlockButton) {
  unlockButton.addEventListener("click", () => {
    // Tone.start() inside unlock() is invoked synchronously within this user-gesture
    // handler, satisfying the browser's activation requirement (REQ-AUDIO-001).
    void backend.unlock().then((state) => {
      setText("state", state);
      if (state === "ready") {
        const handle = backend.playSound({ soundEvent: "ui.confirm", volume: 0.7 });
        const diag = backend.getDiagnostics();
        setText("diag", `played=${!handle.stopped} intents_played=${diag.intents_played}`);
      } else {
        setText("diag", `not-ready state=${state}`);
      }
    });
  });
}

setText("state", "loaded");
