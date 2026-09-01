/**
 * Runs the real extraction pipeline over a PDF in Node and prints what
 * the reader would actually see: detection mode, chapters, sentences.
 */
import { readFileSync } from "node:fs";

// pdfjs needs a DOM-ish global before the module is pulled in.
(globalThis as unknown as { window?: unknown }).window = undefined;

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { buildChapters } = await import("../lib/pdf/sectioning");

const file = process.argv[2];
const data = new Uint8Array(readFileSync(file));

const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;

interface Item { text: string; fontSize: number; y: number; x: number; width: number }
const pages: { pageNumber: number; items: Item[] }[] = [];

for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  const items: Item[] = [];
  for (const raw of content.items as { str?: string; transform?: number[]; width?: number; hasEOL?: boolean; height?: number }[]) {
    if (typeof raw.str !== "string" || !raw.str) continue;
    const t = raw.transform;
    const x = Array.isArray(t) ? t[4] : 0;
    const y = Array.isArray(t) ? t[5] : 0;
    const fontSize = Array.isArray(t) ? Math.abs(t[3]) : raw.height || 0;
    const width = typeof raw.width === "number" ? raw.width : 0;
    items.push({ text: raw.str, fontSize, y, x, width });
    if (raw.hasEOL) items.push({ text: "\n", fontSize, y, x, width: 0 });
  }
  pages.push({ pageNumber: p, items });
}

console.log("=== RAW ITEMS (page 3, chapter 1) ===");
for (const it of pages[2].items.slice(0, 8)) {
  if (it.text === "\n") { console.log("   <EOL>"); continue; }
  console.log(`   size=${it.fontSize.toFixed(1).padStart(5)} y=${it.y.toFixed(0).padStart(4)} "${it.text.slice(0, 58)}"`);
}

const rawOutline = await doc.getOutline().catch(() => null);
const outline: { title: string; pageNumber: number }[] = [];
if (rawOutline) {
  for (const node of rawOutline) {
    try {
      const dest = typeof node.dest === 'string' ? await doc.getDestination(node.dest) : node.dest;
      if (Array.isArray(dest) && dest[0]) {
        const pi = await doc.getPageIndex(dest[0] as never);
        outline.push({ title: (node.title || '').trim(), pageNumber: pi + 1 });
      }
    } catch {}
  }
}
const book = buildChapters({ title: "The Long Quiet", pageCount: doc.numPages, pages, outline: outline.length ? outline : null } as never);

console.log(`\n=== RESULT ===`);
console.log(`detectionMode : ${book.detectionMode}`);
console.log(`chapters      : ${book.chapters.length}`);
for (const c of book.chapters) {
  console.log(`\n  [${c.id}] "${c.title}"  (p.${c.startPage}, ${c.sentences.length} sentences)`);
  c.sentences.slice(0, 4).forEach((s, i) => console.log(`     ${i}. ${s.slice(0, 96)}`));
  if (c.sentences.length > 4) console.log(`     … +${c.sentences.length - 4} more`);
}

// Integrity checks
console.log(`\n=== INTEGRITY ===`);
const all = book.chapters.flatMap(c => c.sentences).join(" ");
const checks: [string, boolean][] = [
  ["hyphenated 'platform' rejoined", all.includes("platform") && !all.includes("plat- form")],
  ["hyphenated 'uncertain' rejoined", all.includes("uncertain") && !all.includes("un- certain")],
  ["'Mr. Ellis' kept together", all.includes("Mr. Ellis")],
  ["'Dr. Halloway' kept together", all.includes("Dr. Halloway")],
  ["decimal 4.15 intact", all.includes("4.15")],
  ["'e.g.' not split into a sentence", !/^e\.g\.$/m.test(all)],
  ["no doubled periods", !all.includes("..")],
  ["no space-before-period", !/ \./.test(all)]
];
for (const [name, ok] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);

// ---- why did heading detection fail? ----
const { pagesToParagraphs, sectionsFromHeadings } = await import("../lib/pdf/sectioning");
const paras = pagesToParagraphs({ title: "", pageCount: doc.numPages, pages, outline: null } as never);
console.log(`\n=== PARAGRAPHS (${paras.length}) ===`);
paras.forEach((p, i) => console.log(`  ${String(i).padStart(2)}  size=${p.fontSize.toFixed(1).padStart(5)}  "${p.text.slice(0, 70)}"`));
const sizes = paras.map(p => p.fontSize).filter(s => s > 0).sort((a, b) => a - b);
const median = sizes[Math.floor(sizes.length / 2)];
console.log(`\n  paragraphs=${paras.length} (need >=10)`);
console.log(`  median font=${median}  threshold=${(median * 1.3).toFixed(2)}`);
console.log(`  headings via size: ${paras.filter(p => p.fontSize >= median * 1.3).length}`);
console.log(`  sectionsFromHeadings -> ${sectionsFromHeadings(paras)?.length ?? "null"}`);
