/**
 * Run an actual source-backed Gauntlet character in Chromium. Evidence/PNGs are
 * written outside Git and emitted as CI artifacts; never approves game assets.
 *
 * bun run scripts/foundations/real-browser/run.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dir, "../../..");
const INPUT = path.join(ROOT, ".tmp", "foundations", "quaternius");
const RAW = path.join(INPUT, "raw");
const OUT = path.join(ROOT, ".tmp", "foundations", "browser-proof");
const INVENTORY = path.join(INPUT, "inventory.json");
const HTML = `<!doctype html><html><head><meta charset="UTF-8"><style>
html,body{margin:0;background:#101c2c}canvas{width:720px;height:720px;display:block}
</style></head><body><canvas id="stage" width="720" height="720"></canvas>
<script type="module" src="/scene.js"></script></body></html>`;

type Pose = {
  state: string; clip: string | null; pixels: number; renderCalls: number;
  triangles: number; skinMeshes: number; bones: number; animatedBones: number;
  position: number[]; targetPosition: number[]; averageMs: number; maxMs: number;
  signature: string | null;
};

function assert(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Error("FOUNDATION_REAL_BROWSER_GATE: " + why);
}

function httpAsset(target: string): Response {
  const relative = target.slice("/raw/".length);
  let decoded: string;
  try { decoded = decodeURIComponent(relative); }
  catch { return new Response("Malformed path", { status: 400 }); }
  const filename = path.resolve(RAW, decoded);
  const rel = path.relative(RAW, filename);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return new Response("Unsafe path", { status: 403 });
  }
  const type = filename.endsWith(".gltf") ? "model/gltf+json"
    : filename.endsWith(".glb") ? "model/gltf-binary"
    : filename.endsWith(".png") ? "image/png"
    : filename.endsWith(".jpg") || filename.endsWith(".jpeg") ? "image/jpeg"
    : "application/octet-stream";
  return new Response(Bun.file(filename), { headers: { "content-type": type } });
}

async function main(): Promise<void> {
  const importer = path.join(ROOT, "scripts", "foundations", "import_quaternius.py");
  // Always rebuild from actual source ZIPs so the evidence cannot be satisfied by
  // a synthetic catalog or a stale derivative from a previous run.
  const prepare = Bun.spawnSync(["python3", importer,
    "--sources", path.join(ROOT, "assets", "sources", "quaternius"),
    "--output", INPUT,
  ], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  assert(prepare.exitCode === 0, "actual source import failed (check Git LFS payloads)");
  const inv = await Bun.file(INVENTORY).json() as {
    assets: Array<{ kind: string; animation_clips: string[]; root_motion: boolean }>;
  };
  assert(inv.assets.length === 10, "expected 10 primary source assets");
  assert(inv.assets.filter(x => x.kind === "character").length === 2, "expected both body types");

  fs.mkdirSync(OUT, { recursive: true });
  const built = await Bun.build({
    entrypoints: [path.join(ROOT, "scripts", "foundations", "real-browser", "scene.ts")],
    outdir: OUT,
    target: "browser",
    naming: "scene.js",
    minify: false,
  });
  if (!built.success) {
    for (const item of built.logs) console.error(String(item));
    throw new Error("Failed to bundle actual Gauntlet browser scene");
  }
  const bundledPath = path.join(OUT, "scene.js");
  assert(fs.existsSync(bundledPath), "browser bundle missing");
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const pathname = new URL(req.url).pathname;
      if (pathname === "/") return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (pathname === "/scene.js") return new Response(Bun.file(bundledPath), { headers: { "content-type": "application/javascript" } });
      if (pathname === "/inventory.json") return new Response(Bun.file(INVENTORY), { headers: { "content-type": "application/json" } });
      if (pathname.startsWith("/raw/")) return httpAsset(pathname);
      return new Response("Not Found", { status: 404 });
    },
  });
  const browser = await chromium.launch({
    headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
      "--enable-webgl", "--disable-web-security=false"],
  });
  const final: {
    status: "pass"; sourceBacked: true; timestamp: string;
    assetCount: number; characters: Record<string, { poses: Pose[]; errors: string[] }>;
  } = {
    status: "pass", sourceBacked: true, timestamp: new Date().toISOString(),
    assetCount: inv.assets.length, characters: {},
  };
  try {
    for (const gender of ["female", "male"]) {
      const page = await browser.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("pageerror", err => errors.push("pageerror: " + err.message));
      page.on("console", entry => {
        if (entry.type() === "error" || entry.type() === "warning") errors.push(entry.type() + ": " + entry.text());
      });
      page.on("response", response => {
        if (response.status() >= 400) errors.push("HTTP " + response.status() + " " + response.url());
      });
      await page.goto(`http://127.0.0.1:${server.port}/?gender=${gender}`, { waitUntil: "load" });
      await page.waitForFunction(() => {
        const proof = (window as any).__gauntletFoundation;
        return proof?.ready || proof?.error;
      }, { timeout: 120_000 });
      const startup = await page.evaluate(() => {
        const proof = (window as any).__gauntletFoundation;
        return { ready: proof.ready, error: proof.error, provenance: proof.provenance };
      });
      assert(startup.ready, gender + " loader failed: " + String(startup.error));
      const poses: Pose[] = [];
      for (const state of ["idle", "walk", "run", "punch", "sword-attack", "swim"] as const) {
        const sample = await page.evaluate(({ state, frames }) =>
          (window as any).__gauntletFoundation.sample(state, frames), { state, frames: 52 });
        poses.push(sample);
        assert(Boolean(sample.clip), gender + " " + state + " has no clip");
        assert(sample.skinMeshes > 0 && sample.bones >= 65, gender + " missing skinned meshes or bones");
        assert(sample.renderCalls > 0 && sample.triangles > 0, gender + " not rendering geometry");
        assert(sample.pixels > 175, gender + " " + state + " no visible model pixels");
        assert(sample.animatedBones >= 3, gender + " " + state + " animation did not change bone transforms");
        assert(JSON.stringify(sample.position) === JSON.stringify(sample.targetPosition),
          gender + " " + state + " visual state changed Koota position");
        assert(sample.averageMs < 150, gender + " " + state + " unacceptable average synchronous frame time");
        await page.screenshot({ path: path.join(OUT, `${gender}-${state}.png`) });
      }
      // Three's PropertyBinding warnings indicate "the clip exists" but has
      // failed to locate real model target bones. Treat as a hard test failure.
      assert(!errors.some(s => /PropertyBinding|No target node|Could not find|Error|HTTP 4|HTTP 5/i.test(s)),
        gender + " browser errors: " + errors.join(" | ").slice(0, 1000));
      final.characters[gender] = { poses, errors };
      await page.close();
    }
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(final, null, 2) + "\n");
    console.log("FOUNDATION_REAL_BROWSER_PASS", JSON.stringify({
      status: final.status,
      assetCount: final.assetCount,
      characters: Object.fromEntries(Object.entries(final.characters).map(([k, v]) => [k, v.poses.map(p => ({
        state: p.state, clip: p.clip, animatedBones: p.animatedBones,
        pixels: p.pixels, calls: p.renderCalls, triangles: p.triangles,
        avgMs: Math.round(p.averageMs * 100) / 100,
      }))])),
    }));
  } finally {
    await browser.close();
    server.stop(true);
  }
}

main().catch(e => { console.error(e?.stack ?? String(e)); process.exitCode = 1; });
