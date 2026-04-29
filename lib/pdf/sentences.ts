/**
 * Robust sentence splitter.
 *
 * Strategy:
 *   1. Strip stuff that sounds bad in TTS (LaTeX, code fences, box-drawing).
 *   2. Use Intl.Segmenter('en', { granularity: 'sentence' }) when available.
 *   3. Regex fallback that respects common abbreviations + decimals + ellipses.
 */

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

  if (hasIntlSegmenter()) {
    const Segmenter = (Intl as unknown as { Segmenter: SegmenterCtor }).Segmenter;
    const seg = new Segmenter("en", { granularity: "sentence" });
    const out: string[] = [];
    for (const part of seg.segment(cleaned)) {
      const s = part.segment.trim();
      if (s) out.push(s);
    }
    return mergeAbbreviationFalsePositives(out);
  }

  return regexSplit(cleaned);
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
