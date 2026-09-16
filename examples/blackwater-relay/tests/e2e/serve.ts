/**
 * Blackwater Relay — deterministic loopback server for the built game (T22).
 * Serves dist/ (index.html + game.js), the committed assets (service-drone GLB),
 * and a favicon so page-driven network evidence is all-OK by construction.
 * Loopback only; no external network.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ServedGame {
  url: string;
  port: number;
  stop: () => void;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function serveGame(projectRoot: string): ServedGame {
  const distDir = path.join(projectRoot, "dist");
  const assetsDir = path.join(projectRoot, "assets");

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const pathname = url.pathname;

      if (pathname === "/" || pathname === "/index.html") {
        return new Response(fs.readFileSync(path.join(distDir, "index.html")), {
          headers: { "content-type": MIME[".html"] },
        });
      }
      if (pathname === "/game.js") {
        return new Response(fs.readFileSync(path.join(distDir, "game.js")), {
          headers: { "content-type": MIME[".js"] },
        });
      }
      // T23 networked client page (never imported by the single-player build).
      if (pathname === "/net.html") {
        return new Response(fs.readFileSync(path.join(distDir, "net.html")), {
          headers: { "content-type": MIME[".html"] },
        });
      }
      if (pathname === "/net-client.js") {
        return new Response(fs.readFileSync(path.join(distDir, "net-client.js")), {
          headers: { "content-type": MIME[".js"] },
        });
      }
      if (pathname === "/favicon.ico") {
        // 1x1 transparent ICO stand-in: keeps observed page responses all-OK.
        const bytes = Uint8Array.from([
          0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00,
          0x18, 0x00, 0x30, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00, 0x28, 0x00,
          0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x00,
          0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]);
        return new Response(bytes, { headers: { "content-type": MIME[".ico"] } });
      }
      if (pathname.startsWith("/assets/")) {
        const rel = pathname.slice("/assets/".length);
        const file = path.resolve(assetsDir, rel);
        if (!file.startsWith(assetsDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return new Response("not found", { status: 404 });
        }
        const ext = path.extname(file).toLowerCase();
        return new Response(fs.readFileSync(file), {
          headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    port: server.port as number,
    stop: () => server.stop(true),
  };
}
