import { readFileSync } from "node:fs";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { buildChapters } = await import("../lib/pdf/sectioning");
const data = new Uint8Array(readFileSync(process.argv[2]));
const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
const pages = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const c = await page.getTextContent();
  const items = [];
  for (const raw of c.items as any[]) {
    if (typeof raw.str !== "string" || !raw.str) continue;
    const t = raw.transform;
    items.push({ text: raw.str, fontSize: Math.abs(t[3]), y: t[5], x: t[4], width: raw.width ?? 0 });
    if (raw.hasEOL) items.push({ text: "\n", fontSize: Math.abs(t[3]), y: t[5], x: t[4], width: 0 });
  }
  pages.push({ pageNumber: p, items });
}
const book = buildChapters({ title: "Thinking in Bets", pageCount: doc.numPages, pages, outline: null } as any);
const sentences = book.chapters.flatMap(c => c.sentences);
const all = sentences.join(" ");

console.log(`chapters=${book.chapters.length}  sentences=${sentences.length}  mode=${book.detectionMode}`);
console.log(`\nINTRODUCTION opener: "${book.chapters.find(c=>c.title==='INTRODUCTION')?.sentences[0]?.slice(0,80)}"`);

console.log(`\n=== ARTIFACT SCAN ===`);
const orphanLetters = sentences.filter(s => /^[A-Z]\s/.test(s.trim()) && s.trim().length < 60).slice(0, 5);
const lowerStarts = sentences.filter(s => /^[a-z]/.test(s.trim()));
const brokenWords = (all.match(/\b\w+- \w+\b/g) || []).slice(0, 8);
const doubleSpace = (all.match(/  +/g) || []).length;
const tinySentences = sentences.filter(s => s.trim().length <= 3);
const longSentences = sentences.filter(s => s.length > 400);
const checks: [string, number, string[]][] = [
  ["sentences starting lowercase (broken splits)", lowerStarts.length, lowerStarts.slice(0,4).map(s=>s.slice(0,60))],
  ["hyphen-space broken words", brokenWords.length, brokenWords],
  ["orphan single-letter starts", orphanLetters.length, orphanLetters],
  ["sentences <= 3 chars", tinySentences.length, tinySentences.slice(0,6)],
  ["sentences > 400 chars (over cap)", longSentences.length, []],
  ["double spaces", doubleSpace, []]
];
for (const [name, n, ex] of checks) {
  console.log(`  ${n === 0 ? "CLEAN" : String(n).padStart(5)}  ${name}`);
  ex.forEach(e => console.log(`           e.g. "${e}"`));
}

// did the drop cap actually reassemble into a real word?
const intro = book.chapters.find(c => c.title === "INTRODUCTION");
console.log(`\n=== DROP CAP CHECK ===`);
intro?.sentences.slice(0, 3).forEach((s, i) => console.log(`  ${i}. ${s.slice(0, 90)}`));
console.log(`  contains "When I was twenty-six": ${all.includes("When I was twenty-six")}`);
console.log(`  contains broken "hen I was twenty-six": ${all.includes(" hen I was twenty-six")}`);
