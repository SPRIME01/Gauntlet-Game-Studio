/**
 * Blackwater Relay — browser entry point (T22).
 * Bundled by scripts/bundle.ts into dist/game.js; dist/index.html boots it.
 */

import { bootBrowserGame } from "./game/browser";

window.addEventListener("DOMContentLoaded", () => {
  bootBrowserGame().catch((err) => {
    const status = document.getElementById("boot-status");
    if (status) {
      status.textContent = `boot failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    console.error(err);
  });
});
