/**
 * Repro harness for the word-splitting regression.
 * Feeds synthetic pdf.js-style item streams through buildChapters and
 * asserts words survive intact.
 */
import { buildChapters } from "../lib/pdf/sectioning";
import type { ExtractedDoc, ExtractedTextItem } from "../lib/pdf/extract";

type Item = { text: string; fontSize?: number; x?: number };
type Line = { y: number; items: Item[] };

function page(pageNumber: number, lines: Line[]) {
  const items: ExtractedTextItem[] = [];
  for (const ln of lines) {
    let x = 50;
    for (const it of ln.items) {
      items.push({ text: it.text, fontSize: it.fontSize ?? 11, y: ln.y, x: it.x ?? x });
      x += it.text.length * 5;
    }
    items.push({ text: "\n", fontSize: 11, y: ln.y, x });
  }
  return { pageNumber, items };
}

function doc(pages: ReturnType<typeof page>[]): ExtractedDoc {
  return { title: "T", pageCount: pages.length, pages, outline: null };
}

function allText(d: ExtractedDoc): string {
  return buildChapters(d).chapters.flatMap((c) => c.sentences).join(" ");
}

let failures = 0;
function check(name: string, actual: string, mustContain: string[], mustNotContain: string[]) {
  const missing = mustContain.filter((w) => !actual.includes(w));
  const present = mustNotContain.filter((w) => actual.includes(w));
  const ok = missing.length === 0 && present.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    if (missing.length) console.log(`        expected intact: ${JSON.stringify(missing)}`);
    if (present.length) console.log(`        found broken:    ${JSON.stringify(present)}`);
    console.log(`        got: ${JSON.stringify(actual.slice(0, 220))}`);
  }
}

// 1. Hyphenated word across a line break (same font)
check("hyphenated word rejoins across lines",
  allText(doc([page(1, [
    { y: 700, items: [{ text: "This is a hyphen-" }] },
    { y: 686, items: [{ text: "ated word here." }] },
  ])])),
  ["hyphenated word here."], ["hyphen- ated", "hyphen-.", "hyphen- "]);

// 2. Sentence spanning lines where one line has a bold run (font shift >1pt)
check("sentence survives a font-size shift mid-sentence",
  allText(doc([page(1, [
    { y: 700, items: [{ text: "The quick " }, { text: "brown", fontSize: 12.4 }, { text: " fox jumps over" }] },
    { y: 686, items: [{ text: "the lazy dog." }] },
  ])])),
  ["The quick brown fox jumps over the lazy dog."], ["jumps over.", "over. the"]);

// 3. Adjacent items on one line must not fuse into one word
check("adjacent style runs keep their space",
  allText(doc([page(1, [
    { y: 700, items: [{ text: "Hello" }, { text: " " }, { text: "world today." }] },
  ])])),
  ["Hello world today."], ["Helloworld"]);

// 4. Long unbroken run must not be cut mid-word by the 350-char cap
const longWords = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ") + ".";
check("350-char cap cuts only at whitespace",
  allText(doc([page(1, [{ y: 700, items: [{ text: longWords }] }])])),
  ["word0 ", " word59."], ["wor d", "wo rd"]);

// 5. Real-world front matter should not get periods jammed inside a title
check("no bogus period inserted mid-title",
  allText(doc([page(1, [
    { y: 700, items: [{ text: "CHAPTER 1" , fontSize: 16 }] },
    { y: 660, items: [{ text: "How to Become the Smartest Person" }] },
    { y: 646, items: [{ text: "in Any Room" }] },
  ])])),
  ["How to Become the Smartest Person in Any Room"], ["Smartest Person."]);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILING"}`);
process.exit(failures === 0 ? 0 : 1);
