/**
 * Minimal deterministic PNG decoder for reference-imagery evidence checks.
 *
 * Supports the subset of PNG needed to verify committed reference fixtures
 * without adding dependencies or network access: 8-bit depth, non-interlaced,
 * color types 0 (gray), 2 (RGB), 4 (gray+alpha), 6 (RGBA), 3 (palette),
 * filter types 0-4. Decompression uses node:zlib (offline, deterministic).
 */

import * as zlib from "node:zlib";

export interface DecodedImage {
  width: number;
  height: number;
  /** 8-bit grayscale luminance, row-major, length = width * height. */
  gray: Uint8Array;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1; // grayscale
    case 2:
      return 3; // rgb
    case 3:
      return 1; // palette index
    case 4:
      return 2; // gray + alpha
    case 6:
      return 4; // rgba
    default:
      return -1;
  }
}

export function decodePngGrayscale(bytes: Uint8Array): DecodedImage {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("REFERENCE_DECODE_FAILED: not a PNG (bad signature)");
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  let palette: Buffer | null = null;
  const idat: Buffer[] = [];

  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const dataStart = pos + 8;
    if (dataStart + len > buf.length) throw new Error("REFERENCE_DECODE_FAILED: truncated chunk");
    const data = buf.subarray(dataStart, dataStart + len);
    pos = dataStart + len + 4; // skip CRC
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
  }

  if (width <= 0 || height <= 0) throw new Error("REFERENCE_DECODE_FAILED: missing IHDR");
  if (bitDepth !== 8) throw new Error(`REFERENCE_DECODE_FAILED: unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("REFERENCE_DECODE_FAILED: interlaced PNG not supported");
  const channels = channelsForColorType(colorType);
  if (channels < 0) throw new Error(`REFERENCE_DECODE_FAILED: unsupported color type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const expected = (stride + 1) * height;
  if (raw.length < expected) throw new Error("REFERENCE_DECODE_FAILED: pixel data truncated");

  const pixels = new Uint8Array(width * height * channels);
  let prevStart = -1;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const outStart = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[rowStart + i];
      const a = i >= channels ? pixels[outStart + i - channels] : 0;
      const b = prevStart >= 0 ? pixels[prevStart + i] : 0;
      const c = prevStart >= 0 && i >= channels ? pixels[prevStart + i - channels] : 0;
      let val: number;
      switch (filter) {
        case 0:
          val = x;
          break;
        case 1:
          val = x + a;
          break;
        case 2:
          val = x + b;
          break;
        case 3:
          val = x + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          val = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`REFERENCE_DECODE_FAILED: unsupported filter ${filter}`);
      }
      pixels[outStart + i] = val & 0xff;
    }
    prevStart = outStart;
  }

  const gray = new Uint8Array(width * height);
  const pxCount = width * height;
  for (let i = 0; i < pxCount; i++) {
    if (colorType === 0) {
      gray[i] = pixels[i];
    } else if (colorType === 4) {
      gray[i] = pixels[i * 2];
    } else if (colorType === 6) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      const a = pixels[i * 4 + 3];
      gray[i] = a === 0 ? 255 : Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    } else if (colorType === 2) {
      gray[i] = Math.round(0.2126 * pixels[i * 3] + 0.7152 * pixels[i * 3 + 1] + 0.0722 * pixels[i * 3 + 2]);
    } else {
      const idx = pixels[i];
      const r = palette ? palette[idx * 3] : 0;
      const g = palette ? palette[idx * 3 + 1] : 0;
      const b = palette ? palette[idx * 3 + 2] : 0;
      gray[i] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
  }

  return { width, height, gray };
}
