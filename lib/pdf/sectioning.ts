/**
 * Section (chapter) detection.
 *
 * Three-tier strategy, in order:
 *   1. Use PDF outline (TOC) when it has ≥3 entries.
 *   2. Heading heuristic: paragraphs whose font size is in the top decile
 *      AND whose text is short and looks heading-shaped.
 *   3. Fallback: every ~3000 words.
 */

import type { ExtractedDoc, ExtractedTextItem } from "./extract";
import { splitSentences } from "./sentences";

export interface Chapter {
  id: string;
  title: string;
  /** 1-based page where this chapter begins (best-effort). */
  startPage: number;
  sentences: string[];
}

export interface BookContent {
  title: string;
  pageCount: number;
  chapters: Chapter[];
  detectionMode: "outline" | "heading" | "wordSplit";
}

interface Paragraph {
  page: number;
  text: string;
  fontSize: number;
}

const HEADING_TITLE_PATTERNS = [
  /^(chapter|section|part)\s+([ivxlcdm]+|\d+)/i,
  /^(prologue|epilogue|preface|introduction|foreword|afterword|conclusion)\b/i
];

/* --- public API ------------------------------------------------------- */

export function buildChapters(doc: ExtractedDoc): BookContent {
  const paragraphs = pagesToParagraphs(doc);

  const fromOutline = doc.outline ? sectionsFromOutline(doc.outline, paragraphs) : null;
  if (fromOutline && fromOutline.length >= 3) {
    return finalize(doc, fromOutline, "outline");
  }

  const fromHeadings = sectionsFromHeadings(paragraphs);
  if (fromHeadings && fromHeadings.length >= 3) {
    return finalize(doc, fromHeadings, "heading");
  }

  return finalize(doc, sectionsByWordSplit(paragraphs), "wordSplit");
}

/* --- paragraph assembly ---------------------------------------------- */

/**
 * Group consecutive items on the same page+y-band into a paragraph. PDFs
 * lay out text item-by-item; we coalesce items at similar y-coordinates
 * and split on visible vertical gaps.
 */
function pagesToParagraphs(doc: ExtractedDoc): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const page of doc.pages) {
    const lines = groupItemsIntoLines(page.items);
    let buf: { text: string; fontSize: number } | null = null;
    let prevY: number | null = null;
    for (const line of lines) {
      const text = line.text.trim();
      if (!text) {
        if (buf) {
          paragraphs.push({ page: page.pageNumber, text: buf.text, fontSize: buf.fontSize });
          buf = null;
        }
        prevY = null;
        continue;
      }
      const lineFont = line.fontSize;
      const verticalGap = prevY != null ? Math.abs(prevY - line.y) : 0;
      const lineHeight = lineFont * 1.4 || 14;
      // Only a *substantially larger* line opens a new block (a real
      // heading). Small font deltas come from bold / italic / superscript
      // runs inside a paragraph; splitting on those chopped sentences in
      // half and — once buildChapter began appending terminators — put a
      // period in the middle of a sentence.
      const prevFont = buf?.fontSize ?? 0;
      const fontJump = prevFont > 0 ? lineFont - prevFont : 0;
      const headingLike = fontJump > Math.max(1.5, prevFont * 0.15);
      const newParagraph = !buf || verticalGap > lineHeight * 1.6 || headingLike;
      if (newParagraph) {
        if (buf) {
          paragraphs.push({ page: page.pageNumber, text: buf.text, fontSize: buf.fontSize });
        }
        buf = { text, fontSize: lineFont };
      } else {
        buf!.text = joinWrappedLines(buf!.text, text);
        buf!.fontSize = Math.max(buf!.fontSize, lineFont);
      }
      prevY = line.y;
    }
    if (buf) paragraphs.push({ page: page.pageNumber, text: buf.text, fontSize: buf.fontSize });
  }
  return dropChrome(paragraphs);
}

/**
 * Join two wrapped lines belonging to the same paragraph.
 *
 * Book text is hyphenated at the right margin, so "hyphen-" + "ated" must
 * rejoin as "hyphenated"; gluing them with a space is exactly what
 * produced visibly broken words. We drop the hyphen rather than keep it:
 * spoken aloud "well-known" and "wellknown" are indistinguishable, while
 * "well- known" is audibly wrong.
 */
function joinWrappedLines(prev: string, next: string): string {
  if (/[A-Za-z]-$/.test(prev) && /^[a-z]/.test(next)) {
    return prev.slice(0, -1) + next;
  }
  return `${prev} ${next}`;
}

interface Line {
  y: number;
  text: string;
  fontSize: number;
}

function groupItemsIntoLines(items: ExtractedTextItem[]): Line[] {
  const lines: Line[] = [];
  let cur: { y: number; runs: ExtractedTextItem[] } | null = null;

  const flush = () => {
    if (cur && cur.runs.length) {
      lines.push({
        y: cur.y,
        text: joinRuns(cur.runs),
        fontSize: dominantFontSize(cur.runs)
      });
    }
    cur = null;
  };

  for (const it of items) {
    if (it.text === "\n") {
      flush();
      continue;
    }
    if (!cur) {
      cur = { y: it.y, runs: [it] };
      continue;
    }
    if (Math.abs(cur.y - it.y) <= 1.5) {
      cur.runs.push(it);
    } else {
      flush();
      cur = { y: it.y, runs: [it] };
    }
  }
  flush();
  return lines;
}

/**
 * Concatenate the runs of one line, restoring spaces pdf.js dropped.
 * pdf.js emits a new text item at every style or positioning change, and
 * the space between two words is often expressed as a coordinate jump
 * rather than a space glyph — concatenating blindly fuses words together
 * ("Helloworld").
 */
function joinRuns(runs: ExtractedTextItem[]): string {
  let out = "";
  let prevEnd: number | null = null;
  for (const r of runs) {
    if (out && prevEnd != null) {
      const gap = r.x - prevEnd;
      const spaceWidth = r.fontSize * 0.2; // conservative ~1/5 em
      if (gap > spaceWidth && !/\s$/.test(out) && !/^\s/.test(r.text)) {
        out += " ";
      }
    }
    out += r.text;
    prevEnd = r.x + (r.width || r.text.length * r.fontSize * 0.5);
  }
  return out;
}

/**
 * The font size covering the most characters on a line — not the max. A
 * single bold word must not redefine the whole line's size, otherwise the
 * next (normal) line looks like a font change and wrongly opens a new
 * paragraph.
 */
function dominantFontSize(runs: ExtractedTextItem[]): number {
  const weight = new Map<number, number>();
  for (const r of runs) {
    const bucket = Math.round(r.fontSize * 2) / 2;
    weight.set(bucket, (weight.get(bucket) ?? 0) + Math.max(1, r.text.trim().length));
  }
  let best = 0;
  let bestWeight = -1;
  for (const [size, w] of weight) {
    if (w > bestWeight) {
      best = size;
      bestWeight = w;
    }
  }
  return best;
}

/**
 * Drop running headers/footers/page numbers: short paragraphs whose exact
 * text repeats on >40% of pages.
 */
function dropChrome(paragraphs: Paragraph[]): Paragraph[] {
  const pages = new Set(paragraphs.map((p) => p.page));
  if (pages.size < 4) return filterPageNumbers(paragraphs);
  const counts = new Map<string, number>();
  for (const p of paragraphs) {
    if (p.text.length <= 80) {
      counts.set(p.text, (counts.get(p.text) ?? 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.floor(pages.size * 0.4));
  const chrome = new Set([...counts.entries()].filter(([, n]) => n >= threshold).map(([t]) => t));
  return filterPageNumbers(paragraphs.filter((p) => !chrome.has(p.text)));
}

function filterPageNumbers(paragraphs: Paragraph[]): Paragraph[] {
  return paragraphs.filter((p) => {
    const t = p.text.trim();
    return !(t.length <= 4 && /^[0-9ivxlcdm]+$/i.test(t));
  });
}

/* --- tier 1: outline -------------------------------------------------- */

function sectionsFromOutline(
  outline: NonNullable<ExtractedDoc["outline"]>,
  paragraphs: Paragraph[]
): Chapter[] | null {
  if (outline.length < 3) return null;
  // Sort by page so we can scan sequentially.
  const sorted = [...outline].sort((a, b) => a.pageNumber - b.pageNumber);
  const chapters: Chapter[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const next = sorted[i + 1];
    const startPage = entry.pageNumber;
    const endPageExclusive = next ? next.pageNumber : Number.POSITIVE_INFINITY;
    const body = paragraphs.filter((p) => p.page >= startPage && p.page < endPageExclusive);
    chapters.push(buildChapter(`ch_${i + 1}`, entry.title, startPage, body));
  }
  return chapters.filter((c) => c.sentences.length > 0);
}

/* --- tier 2: heading heuristic --------------------------------------- */

function sectionsFromHeadings(paragraphs: Paragraph[]): Chapter[] | null {
  if (paragraphs.length < 10) return null;
  const sizes = paragraphs.map((p) => p.fontSize).filter((s) => s > 0).sort((a, b) => a - b);
  if (sizes.length < 10) return null;
  const median = sizes[Math.floor(sizes.length / 2)];
  const threshold = median * 1.3;

  const headingIdx: number[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const wordCount = p.text.trim().split(/\s+/).length;
    const big = p.fontSize >= threshold;
    const looksLikeNamedHeading = HEADING_TITLE_PATTERNS.some((re) => re.test(p.text.trim()));
    const heading =
      (big && p.text.length < 100 && wordCount <= 14 && /[A-Za-z]/.test(p.text)) ||
      looksLikeNamedHeading;
    if (heading) {
      if (headingIdx.length === 0 || i - headingIdx[headingIdx.length - 1] >= 2) {
        headingIdx.push(i);
      }
    }
  }
  if (headingIdx.length < 3) return null;

  const chapters: Chapter[] = [];
  for (let i = 0; i < headingIdx.length; i++) {
    const start = headingIdx[i];
    const end = headingIdx[i + 1] ?? paragraphs.length;
    const head = paragraphs[start];
    const body = paragraphs.slice(start + 1, end);
    chapters.push(buildChapter(`ch_${i + 1}`, head.text.trim().slice(0, 200), head.page, body));
  }
  return chapters.filter((c) => c.sentences.length > 0);
}

/* --- tier 3: word split ---------------------------------------------- */

function sectionsByWordSplit(paragraphs: Paragraph[], maxWords = 3000): Chapter[] {
  const chapters: Chapter[] = [];
  let buf: Paragraph[] = [];
  let words = 0;
  let idx = 0;
  let firstPage = paragraphs[0]?.page ?? 1;
  for (const p of paragraphs) {
    if (buf.length === 0) firstPage = p.page;
    buf.push(p);
    words += p.text.split(/\s+/).length;
    if (words >= maxWords) {
      chapters.push(buildChapter(`ch_${idx + 1}`, `Part ${idx + 1}`, firstPage, buf));
      idx += 1;
      buf = [];
      words = 0;
    }
  }
  if (buf.length) {
    chapters.push(buildChapter(`ch_${idx + 1}`, `Part ${idx + 1}`, firstPage, buf));
  }
  if (chapters.length === 0 && paragraphs.length > 0) {
    chapters.push(buildChapter("ch_1", "Body", paragraphs[0].page, paragraphs));
  }
  return chapters;
}

/* --- helpers --------------------------------------------------------- */

function buildChapter(id: string, title: string, startPage: number, paras: Paragraph[]): Chapter {
  // Front matter (dedication, contents, copyright) carries no terminal
  // punctuation, so contiguous blocks would fuse into one enormous
  // "sentence" that stalls TTS. But a terminator must never be inserted
  // where the next block is really a wrapped continuation of this one —
  // that is what put periods in the middle of sentences. A block starting
  // lowercase is a continuation, so it joins with a plain space.
  const blocks = paras.map((p) => p.text.trim()).filter(Boolean);
  let joined = "";
  for (let i = 0; i < blocks.length; i++) {
    const cur = blocks[i];
    joined += cur;
    if (i === blocks.length - 1) break;
    const next = blocks[i + 1];
    const endsTerminal = /[.!?:;,—-][)"'\s]*$/.test(cur);
    const nextIsContinuation = /^[a-z0-9]/.test(next);
    joined += endsTerminal || nextIsContinuation ? " " : ". ";
  }
  return {
    id,
    title: title || "Untitled",
    startPage,
    sentences: splitSentences(joined)
  };
}

function finalize(
  doc: ExtractedDoc,
  chapters: Chapter[],
  detectionMode: BookContent["detectionMode"]
): BookContent {
  return {
    title: doc.title,
    pageCount: doc.pageCount,
    chapters: chapters.map((c, i) => ({ ...c, id: `ch_${i + 1}` })),
    detectionMode
  };
}
