import { readFileSync } from "node:fs";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const data = new Uint8Array(readFileSync(process.argv[2]));
const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
const outline = await doc.getOutline();
console.log(`outline entries: ${outline ? outline.length : "NONE (null)"}`);
if (outline) {
  for (const o of outline.slice(0, 15)) console.log(`   - ${JSON.stringify(o.title)}  dest=${typeof o.dest}`);
}
