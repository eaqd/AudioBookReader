/** Dump the raw pdf.js runs around a target string, to see exactly what
 *  the extractor is being handed before any of our logic touches it. */
import { readFileSync } from "node:fs";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const file = process.argv[2];
const needle = process.argv[3] ?? "dence";
const data = new Uint8Array(readFileSync(file));
const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;

let shown = 0;
for (let p = 1; p <= doc.numPages && shown < 3; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  const items = (content.items as { str?: string; transform?: number[]; width?: number; hasEOL?: boolean }[])
    .filter((i) => typeof i.str === "string");
  for (let i = 0; i < items.length; i++) {
    if (!items[i].str!.includes(needle)) continue;
    console.log(`\n--- page ${p}, run ${i} (match "${needle}") ---`);
    for (let j = Math.max(0, i - 3); j <= Math.min(items.length - 1, i + 3); j++) {
      const it = items[j];
      const t = it.transform!;
      console.log(
        `  ${j === i ? ">>" : "  "} x=${t[4].toFixed(1).padStart(7)} y=${t[5].toFixed(1).padStart(7)} ` +
        `w=${(it.width ?? 0).toFixed(1).padStart(6)} eol=${it.hasEOL ? "Y" : "n"} ` +
        `str=${JSON.stringify(it.str)}`
      );
    }
    shown++;
    if (shown >= 3) break;
  }
}
if (shown === 0) console.log(`no run containing ${JSON.stringify(needle)} found`);
