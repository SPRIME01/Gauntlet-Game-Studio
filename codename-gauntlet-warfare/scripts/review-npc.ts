import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url).pathname;
const build = await Bun.build({ entrypoints: [root + "scripts/npc-scene.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0].text();
const outDir = process.argv[2] ?? root + ".img2threejs/npc-operator/render";
await mkdir(outDir, { recursive: true });
const server = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  fetch(req) {
    return new URL(req.url).pathname === "/review.js"
      ? new Response(bundle, { headers: { "Content-Type": "text/javascript" } })
      : new Response('<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script type="module" src="/review.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
  },
});
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1254, height: 1254 } });
  const errors: string[] = [], warnings: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "warning") warnings.push(m.text()); if (m.type() === "error") errors.push(m.text()); });
  const views: Record<string, unknown> = {};
  const shots: Array<[string, string]> = [
    ["front", "angle=0"],
    ["front-45", "angle=45"],
    ["right", "angle=90"],
    ["rear", "angle=180"],
    ["left", "angle=270"],
    ["front-sil", "angle=0&silhouette=1"],
    ["right-sil", "angle=90&silhouette=1"],
    ["rear-sil", "angle=180&silhouette=1"],
    ["left-sil", "angle=270&silhouette=1"],
  ];
  for (const [name, query] of shots) {
    await page.goto("http://127.0.0.1:" + server.port + "/?" + query);
    await page.waitForFunction(() => (window as any).reviewReady, { timeout: 30000 });
    views[name] = await page.evaluate(() => (window as any).npcReview);
    await page.screenshot({ path: outDir + "/" + name + ".png" });
  }
  await page.goto("http://127.0.0.1:" + server.port + "/?angle=0&geom=1");
  await page.waitForFunction(() => (window as any).npcGeometry, { timeout: 60000 });
  const geom = await page.evaluate(() => (window as any).npcGeometry);
  await Bun.write(outDir + "/meshes.json", JSON.stringify(geom));
  const sourceSha256 = createHash("sha256").update(await Bun.file(root + "src/assets/operator-npc.ts").bytes()).digest("hex");
  await Bun.write(outDir + "/review.json", JSON.stringify({ sourceSha256, views, errors, warnings }, null, 2));
  console.log(JSON.stringify({ out: outDir, sourceSha256, views, errors, warnings }));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); server.stop(); }
