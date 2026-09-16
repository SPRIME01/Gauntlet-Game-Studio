#!/usr/bin/env bun
/**
 * Blackwater Relay — deterministic browser bundle (T22).
 * Builds dist/game.js (browser bundle of src/main.ts) and dist/index.html.
 * Deterministic inputs, no network, no model calls; assets stay in assets/.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "..");
const outDir = path.join(projectRoot, "dist");

const result = await Bun.build({
  entrypoints: [path.join(projectRoot, "src", "main.ts")],
  outdir: outDir,
  naming: "game.js",
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "none",
});

if (!result.success) {
  console.error("bundle failed:");
  for (const log of result.logs) console.error(String(log));
  process.exit(1);
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blackwater Relay</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #1c2733; }
  #game-canvas { width: 100vw; height: 100vh; display: block; }
  #boot-status {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    color: #cfd8e3; font: 16px/1.4 system-ui, sans-serif; letter-spacing: 0.04em;
  }
  /* DOM/CSS HUD (T17 projection surface) */
  #hud { position: fixed; top: 0; left: 0; right: 0; pointer-events: none; }
  .gauntlet-hud-root { font-family: system-ui, sans-serif; }
  .gauntlet-hud-bar {
    display: flex; gap: 24px; align-items: baseline; padding: 10px 16px;
    color: #e8eef5; background: linear-gradient(180deg, rgba(12,18,26,0.82), rgba(12,18,26,0));
  }
  .gauntlet-hud-message { padding: 0 16px 10px; color: #ffd9a0; font-size: 15px; }
</style>
</head>
<body>
<canvas id="game-canvas"></canvas>
<div id="hud"></div>
<div id="boot-status">loading…</div>
<script type="module" src="/game.js"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(outDir, "index.html"), html);
console.log(`bundled ${path.join(outDir, "game.js")} and index.html`);
