#!/usr/bin/env node
// Builds a PDF that mimics the structures real books actually contain,
// so the extractor and the highlighter get exercised the way a scanned
// bookshelf title would exercise them.
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "real-book.pdf";

// [fontSize, text] per line. Font changes drive heading detection.
const PAGES = [
  // 1: title page — no terminal punctuation anywhere (front-matter trap)
  [
    [22, "THE LONG QUIET"],
    [13, "A Novel of Small Hours"],
    [11, "by A. N. Author"],
    [11, "Fairhaven Press"]
  ],
  // 2: contents — the block that used to fuse into one giant sentence
  [
    [16, "CONTENTS"],
    [11, "Chapter 1  The Arrival"],
    [11, "Chapter 2  Dr. Halloway Explains"],
    [11, "Chapter 3  What the U.S. Report Said"]
  ],
  // 3: chapter 1 — hyphenated wraps + abbreviations + decimals
  [
    [16, "Chapter 1"],
    [13, "The Arrival"],
    [11, "The train pulled in at 4.15 in the afternoon, an hour later than"],
    [11, "the timetable promised. Mr. Ellis had been waiting on the plat-"],
    [11, "form since noon, turning his hat over in his hands. He was un-"],
    [11, "certain whether the delay meant anything at all."],
    [11, "Dr. Halloway had written to him twice, e.g. once in March and"],
    [11, "again in April, and both letters said the same thing in different"],
    [11, "words. The second one ended with a question he had not been"],
    [11, "able to answer."]
  ],
  // 4: chapter 2 — mid-sentence font shifts (bold/italic runs)
  [
    [16, "Chapter 2"],
    [13, "Dr. Halloway Explains"],
    [11, "The doctor set down his cup and said that the whole business"],
    [11, "was, in a word, impossible. He used the word twice, and the"],
    [11, "second time he leaned on it. Ellis noticed that his hands were"],
    [11, "steady, which surprised him more than the claim itself."],
    [11, "\"You understand what that would mean,\" Halloway said. It was"],
    [11, "not a question, so Ellis did not treat it as one."]
  ],
  // 5: chapter 3 — long unbroken paragraph, tests the 350-char cap
  [
    [16, "Chapter 3"],
    [13, "What the U.S. Report Said"],
    [11, "The report ran to three hundred pages and said almost nothing"],
    [11, "that had not already been said elsewhere, but it said it with the"],
    [11, "particular authority that comes from having been printed on"],
    [11, "official paper and bound in official covers, and for that reason"],
    [11, "alone it was quoted for years afterwards by people who had"],
    [11, "never opened it and had no intention of ever doing so."],
    [11, "Ellis read it twice. The second reading took longer."]
  ]
];

const objs = [];
function obj(body) { objs.push(body); return objs.length; }

const pageIds = [];
const contentIds = [];
for (const lines of PAGES) {
  let stream = "BT\n";
  let y = 730;
  for (const [size, text] of lines) {
    const esc = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    stream += `/F1 ${size} Tf\n72 ${y} Td\n(${esc}) Tj\n`;
    stream += `-72 -${y} Td\n`;      // reset origin for the next absolute Td
    y -= Math.round(size * 1.55);
  }
  stream += "ET\n";
  contentIds.push(obj(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`));
}

const fontId = obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
const pagesIdPlaceholder = objs.length + PAGES.length + 1;
for (let i = 0; i < PAGES.length; i++) {
  pageIds.push(obj(
    `<< /Type /Page /Parent ${pagesIdPlaceholder} 0 R /MediaBox [0 0 612 792] ` +
    `/Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
  ));
}
const pagesId = obj(`<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
const catalogId = obj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

let pdf = "%PDF-1.4\n";
const offsets = [0];
objs.forEach((body, i) => {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = pdf.length;
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= objs.length; i++) {
  pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
}
pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

writeFileSync(out, Buffer.from(pdf, "latin1"));
console.log(`wrote ${out} (${PAGES.length} pages, ${pdf.length} bytes)`);
