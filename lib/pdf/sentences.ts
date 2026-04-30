/**
 * Robust sentence splitter.
 *
 * Strategy:
 *   1. Strip stuff that sounds bad in TTS (LaTeX, code fences, box-drawing).
 *   2. Use Intl.Segmenter('en', { granularity: 'sentence' }) when available.
 *   3. Regex fallback that respects common abbreviations + decimals + ellipses.
 *   4. Hard-cap each output segment at MAX_SENTENCE_CHARS — front matter
 *      (dedications, table of contents, copyright pages) often has no
 *      sentence punctuation and would otherwise produce 1000+ char blobs
 *      that break TTS pacing and hang the synthesizer.
 */

const MAX_SENTENCE_CHARS = 350;

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "jr", "sr", "st", "prof", "rev", "hon",
  "e.g", "i.e", "etc", "cf", "vs", "no", "vol", "pp", "fig", "ch",
  "u.s", "u.k", "u.n", "ph.d", "m.d", "b.a", "m.a", "d.c"
]);

const LATEX_INLINE = /\$[^$\n]{1,200}\$/g;
const LATEX_BLOCK = /\\\[[^\]]{1,500}\\\]|\\\(.+?\\\)|\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}/g;
const CODE_FENCE = /```[\s\S]*?```/g;
const HEAVY_PUNCT = /[│┃┄┈─━┆┇┊┋╌╍═║]+/g;

export function cleanForSpeech(s: string): string {
  return s
    .replace(CODE_FENCE, " ")
    .replace(LATEX_BLOCK, " ")
    .replace(LATEX_INLINE, " ")
    .replace(HEAVY_PUNCT, " ")
    .replace(/­/g, "")              // soft hyphens
    .replace(/-\n([a-z])/g, "$1")        // de-hyphenate line breaks
    .replace(/\s+/g, " ")
    .trim();
}

interface SegmenterCtor {
  new (locale: string, options: { granularity: "sentence" }): {
    segment(s: string): Iterable<{ segment: string; isWordLike?: boolean }>;
  };
}

function hasIntlSegmenter(): boolean {
  return typeof Intl !== "undefined" && typeof (Intl as { Segmenter?: unknown }).Segmenter === "function";
}

export function splitSentences(text: string): string[] {
  const cleaned = cleanForSpeech(text);
  if (!cleaned) return [];

  let parts: string[];
  if (hasIntlSegmenter()) {
    const Segmenter = (Intl as unknown as { Segmenter: SegmenterCtor }).Segmenter;
    const seg = new Segmenter("en", { granularity: "sentence" });
    parts = [];
    for (const part of seg.segment(cleaned)) {
      const s = part.segment.trim();
      if (s) parts.push(s);
    }
    parts = mergeAbbreviationFalsePositives(parts);
  } else {
    parts = regexSplit(cleaned);
  }
  return enforceMaxLength(parts, MAX_SENTENCE_CHARS);
}

/**
 * Break any segment longer than `maxLen` chars into smaller pieces. Tries
 * progressively weaker boundaries — sentence punctuation, then clause
 * punctuation, then commas, then word boundaries.
 */
export function enforceMaxLength(sentences: string[], maxLen: number): string[] {
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= maxLen) {
      out.push(s);
      continue;
    }
    out.push(...greedySplit(s, maxLen));
  }
  return out;
}

function greedySplit(text: string, maxLen: number): string[] {
  const result: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxLen) {
    const cut =
      cutAt(remaining, maxLen, /[.!?](?=\s|$)/g) ??
      cutAt(remaining, maxLen, /[;:—](?=\s|$)/g) ??
      cutAt(remaining, maxLen, /,(?=\s)/g) ??
      cutAt(remaining, maxLen, /\s(?=\S)/g) ??
      maxLen;
    const piece = remaining.slice(0, cut).trim();
    if (piece) result.push(piece);
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) result.push(remaining);
  return result;
}

/**
 * Return the END index (exclusive) of the rightmost match of `re` whose
 * match end is ≤ maxLen, or null if none found. We prefer cuts as close
 * to maxLen as possible (without exceeding) so each piece stays full.
 */
function cutAt(text: string, maxLen: number, re: RegExp): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(re)) {
    const end = m.index + m[0].length;
    if (end <= maxLen) best = end;
    else break;
  }
  return best;
}

/**
 * Intl.Segmenter sometimes splits "Dr. Smith" into two; merge those back.
 */
function mergeAbbreviationFalsePositives(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (out.length > 0 && endsWithAbbreviation(out[out.length - 1])) {
      out[out.length - 1] = `${out[out.length - 1]} ${p}`;
    } else {
      out.push(p);
    }
  }
  return out;
}

function endsWithAbbreviation(s: string): boolean {
  // Look at the trailing word before the final period.
  const m = s.match(/(\b[\w.]+)\.\s*$/);
  if (!m) return false;
  const last = m[1].toLowerCase();
  if (ABBREVIATIONS.has(last)) return true;
  // Dotted abbreviations like "U.S." — multiple internal dots.
  if (/^([a-z]\.){1,4}[a-z]$/.test(last)) return true;
  // Single capital letter initial.
  if (/^[a-z]$/.test(last)) return true;
  return false;
}

/** Regex fallback for environments without Intl.Segmenter. */
function regexSplit(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    if (ch === "." || ch === "!" || ch === "?") {
      // ellipsis: keep gobbling
      while (i + 1 < text.length && text[i + 1] === ".") {
        i += 1;
        buf += text[i];
      }
      // followed by whitespace + capital/quote/paren?
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      const next = text[j] ?? "";
      const looksLikeBoundary = /[A-Z"'(\[]/.test(next) && !endsWithAbbreviation(buf.trim());
      if (j === text.length || looksLikeBoundary) {
        out.push(buf.trim());
        buf = "";
        i = j - 1; // outer loop ++ will move to j
      }
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}
