#!/usr/bin/env bun
/**
 * Deterministic reference-fixture generator for the Blackwater Relay field
 * transceiver (T14).
 *
 * Provenance class: project-generated reference fixture ("in-house-generated").
 * This is a stand-in for an image a user would supply; it is REFERENCE-ONLY
 * imagery and must never ship as production content (REQ-ASSET-004). It is
 * registered in assets/manifest.json under `references`, never `records`.
 *
 * Determinism: fixed canvas, fixed geometry, zlib level 9, no timestamps —
 * rerunning this script reproduces byte-identical reference.png.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const WIDTH = 96;
const HEIGHT = 64;

// Grayscale canvas: white background, dark subject (< 128 counts as subject).
const pixels = new Uint8Array(WIDTH * HEIGHT).fill(255);

function rect(x0: number, y0: number, x1: number, y1: number, value: number): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) pixels[y * WIDTH + x] = value;
    }
  }
}

// Subject silhouette (dark, value 30) — matches the committed procedural
// module's front projection: body, antenna mast, antenna cap, two feet.
rect(16, 28, 80, 52, 30); // body
rect(46, 4, 50, 28, 30); // antenna mast
rect(44, 2, 52, 6, 30); // antenna cap
rect(16, 52, 24, 56, 30); // left foot
rect(72, 52, 80, 56, 30); // right foot

// Interior detail — stays strictly inside the body silhouette.
rect(22, 32, 42, 48, 90); // speaker grille
rect(50, 32, 74, 36, 120); // dial strip
rect(50, 40, 74, 44, 90); // toggle bank

// --- Minimal PNG encoder: 8-bit grayscale, filter 0, non-interlaced --------
const raw = Buffer.alloc((WIDTH + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y++) {
  raw[y * (WIDTH + 1)] = 0; // filter type 0 (None)
  for (let x = 0; x < WIDTH; x++) {
    raw[y * (WIDTH + 1) + 1 + x] = pixels[y * WIDTH + x];
  }
}
const idat = zlib.deflateSync(raw, { level: 9 });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 0; // color type: grayscale
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

const outPath = path.join(import.meta.dir, "reference.png");
fs.writeFileSync(outPath, png);
const hash = crypto.createHash("sha256").update(png).digest("hex");
console.log(`wrote ${outPath} (${png.length} bytes) sha256=${hash}`);
