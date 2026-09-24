import { join, extname } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const result = await Bun.build({
  entrypoints: [root + "src/main.ts"],
  outdir: root + "dist",
  target: "browser",
  minify: true,
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
};

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4173),
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;
    if (pathname === "/" || pathname === "/index.html") {
      pathname = "/index.html";
    }

    const filePath = join(root, pathname);
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const ext = extname(pathname).toLowerCase();
      const contentType = mimeTypes[ext] ?? "application/octet-stream";
      return new Response(file, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Gauntlet Warfare running:`);
console.log(`- http://localhost:${server.port}`);
console.log(`- http://127.0.0.1:${server.port}`);

