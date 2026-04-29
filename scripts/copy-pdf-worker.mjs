#!/usr/bin/env node
// Copies pdfjs-dist's worker into public/ so the runtime can fetch it as a
// classic URL via GlobalWorkerOptions.workerSrc. Avoids committing the
// minified 1.3MB binary into git.

import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const dst = resolve(root, "public/pdf.worker.min.mjs");

if (!existsSync(src)) {
  console.warn(`[copy-pdf-worker] missing ${src}; skipping.`);
  process.exit(0);
}
await mkdir(dirname(dst), { recursive: true });
await copyFile(src, dst);
console.log(`[copy-pdf-worker] copied → ${dst}`);
