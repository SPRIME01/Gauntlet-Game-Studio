import { chromium } from "playwright";
const root = new URL("../", import.meta.url).pathname;
const build = await Bun.build({ entrypoints: [root + "scripts/npc-scene.ts"], target: "browser" });
const bundle = await build!.outputs[0].text();
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
  return new URL(req.url).pathname === "/review.js"
    ? new Response(bundle, { headers: { "Content-Type": "text/javascript" } })
    : new Response('<!doctype html><html><body><script type="module" src="/review.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
}});
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1254, height: 1254 } });
await page.goto("http://127.0.0.1:" + server.port + "/");
await page.waitForFunction(() => (window as any).reviewReady, { timeout: 30000 });
const info = await page.evaluate(() => {
  const g = (window as any).__npcModel;
  g.updateWorldMatrix(true, true);
  const out: any = { nodes: {}, screens: {} };
  g.traverse((o: any) => {
    if (o.name && o.name.includes("Hand") || o.name?.includes("hand") || o.name?.includes("Forearm") || o.name?.includes("forearm") || o.name?.includes("Upper arm")) {
      const wp = o.getWorldPosition(new (o.position.constructor as any)());
      out.nodes[o.name] = [+wp.x.toFixed(3), +wp.y.toFixed(3), +wp.z.toFixed(3)];
    }
  });
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close(); server.stop();
