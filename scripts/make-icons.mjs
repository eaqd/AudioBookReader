#!/usr/bin/env node
// Generate brand PNG icons for PWA without any deps. We hand-write a
// minimal PNG (8-bit RGBA): a Spotify-green rounded square + a white
// headphones glyph in the middle.
//
// Outputs:
//   public/icons/icon-192.png
//   public/icons/icon-512.png
//   public/icons/maskable-512.png   (full-bleed background; safe area inside)
//   public/icons/apple-touch-icon.png

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "public", "icons");
await mkdir(outDir, { recursive: true });

// brand
const GREEN = [0x1d, 0xb9, 0x54, 0xff];
const BLACK_BG = [0x05, 0x10, 0x0a, 0xff];   // darker green-black for maskable bg
const WHITE = [0xff, 0xff, 0xff, 0xff];

// generate
await write(192, false, "icon-192.png");
await write(512, false, "icon-512.png");
await write(512, true, "maskable-512.png");
await write(180, false, "apple-touch-icon.png");

console.log(`[make-icons] wrote 4 icons to ${outDir}`);

async function write(size, fullBleed, name) {
  const buf = renderRGBA(size, fullBleed);
  const png = encodePng(size, size, buf);
  await writeFile(resolve(outDir, name), png);
}

/**
 * Rasterize the icon to an RGBA Uint8Array, length size*size*4.
 *
 * Layout:
 *   - Square canvas
 *   - Rounded-square (or full square for maskable) background
 *   - Headphones glyph centered, ~52% of canvas
 */
function renderRGBA(size, fullBleed) {
  const out = new Uint8Array(size * size * 4);
  const radius = fullBleed ? size : Math.round(size * 0.22); // iOS rounds maskable bg
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // background
      if (fullBleed) {
        // full bleed: dark base, then green disc inside the safe area
        // (Android maskable: 80% safe area)
        const inSafe = inCircle(x, y, cx, cy, size * 0.4);
        const c = inSafe ? GREEN : BLACK_BG;
        out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = c[3];
      } else {
        const inside = inRoundedRect(x, y, 0, 0, size, size, radius);
        if (!inside) {
          out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0;
        } else {
          out[i] = GREEN[0]; out[i + 1] = GREEN[1]; out[i + 2] = GREEN[2]; out[i + 3] = GREEN[3];
        }
      }
    }
  }

  drawHeadphones(out, size);
  return out;
}

/** Draw a simple white "headphones" mark covering ~52% of the icon. */
function drawHeadphones(out, size) {
  const cx = size / 2;
  const cy = size * 0.55;
  const headRadius = size * 0.30;        // outer arc
  const headInner = size * 0.245;        // inner arc thickness
  const cupW = size * 0.115;
  const cupH = size * 0.165;
  const stroke = size * 0.06;            // halo thickness

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // arc band over the top half (y < cy)
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      const inArc = y < cy && r >= headInner && r <= headRadius;
      // ear cups: rounded rectangles on left and right
      const inLeftCup = inRoundedRect(
        x, y, cx - headRadius - cupW * 0.3, cy - cupH * 0.3,
        cupW, cupH, cupW * 0.35
      );
      const inRightCup = inRoundedRect(
        x, y, cx + headRadius - cupW * 0.7, cy - cupH * 0.3,
        cupW, cupH, cupW * 0.35
      );
      if (inArc || inLeftCup || inRightCup) {
        // overwrite with white
        const a = 0.95;
        out[i]     = blend(out[i],     WHITE[0], a);
        out[i + 1] = blend(out[i + 1], WHITE[1], a);
        out[i + 2] = blend(out[i + 2], WHITE[2], a);
        out[i + 3] = 0xff;
      }
    }
  }
  // unused vars to keep linters quiet (not used here)
  void stroke;
}

function blend(a, b, alpha) {
  return Math.round(a * (1 - alpha) + b * alpha);
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  // corner check
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/* ---------- PNG encoder (RGBA, 8-bit) ---------- */

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = chunk("IHDR", buildIHDR(width, height));
  const idat = chunk("IDAT", zlib.deflateSync(buildScanlines(width, height, rgba)));
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function buildIHDR(w, h) {
  const buf = Buffer.alloc(13);
  buf.writeUInt32BE(w, 0);
  buf.writeUInt32BE(h, 4);
  buf.writeUInt8(8, 8);   // bit depth
  buf.writeUInt8(6, 9);   // RGBA
  buf.writeUInt8(0, 10);  // compression
  buf.writeUInt8(0, 11);  // filter
  buf.writeUInt8(0, 12);  // interlace
  return buf;
}

function buildScanlines(w, h, rgba) {
  const stride = w * 4;
  const out = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    out[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(out, y * (stride + 1) + 1);
  }
  return out;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
