#!/usr/bin/env bun
/**
 * Blackwater Relay — deterministic browser bundle (T22/T23).
 * Builds dist/game.js (browser bundle of src/main.ts) + dist/index.html (unchanged
 * single-player build), and the T23 networked client page dist/net-client.js
 * (src/net/main.ts) + dist/net.html. Deterministic inputs, no network, no model
 * calls; assets stay in assets/.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "..");
const outDir = path.join(projectRoot, "dist");

async function bundleEntry(entry: string, outputName: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    naming: outputName,
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "none",
  });
  if (!result.success) {
    console.error(`bundle failed for ${entry}:`);
    for (const log of result.logs) console.error(String(log));
    process.exit(1);
  }
}

await bundleEntry(path.join(projectRoot, "src", "main.ts"), "game.js");
await bundleEntry(path.join(projectRoot, "src", "net", "main.ts"), "net-client.js");

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

const netHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blackwater Relay — network client</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #10161d; color: #cfd8e3;
    font: 14px/1.5 system-ui, sans-serif; }
  #net-status { padding: 16px; }
</style>
</head>
<body>
<div id="net-status">booting…</div>
<script type="module" src="/net-client.js"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(outDir, "net.html"), netHtml);
console.log(`bundled ${path.join(outDir, "game.js")}, ${path.join(outDir, "net-client.js")}, index.html, net.html`);
