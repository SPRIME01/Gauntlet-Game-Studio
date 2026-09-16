/**
 * Blackwater Relay — networked client entry point (T23).
 * Bundled by scripts/bundle.ts into dist/net-client.js; dist/net.html boots it.
 * The single-player entry (src/main.ts) never imports this tree.
 */

import { bootNetClientPage } from "./net-page";

window.addEventListener("DOMContentLoaded", () => {
  bootNetClientPage().catch((err) => {
    const status = document.getElementById("net-status");
    if (status) {
      status.textContent = `net boot failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    console.error(err);
  });
});
