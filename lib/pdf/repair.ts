/**
 * Repairs for damage that happens before our code ever sees the text —
 * defects baked into the PDF or introduced by pdf.js while decoding it.
 */

/** Ligatures whose glyphs commonly lack a Unicode mapping. */
const LIGATURES = ["fi", "fl", "ff", "ffi", "ffl"];

/**
 * Words frequently seen broken by a dropped ligature. Deliberately a
 * fixed list rather than a heuristic: "at" must never quietly become
 * "flat", so a repair only happens when the result is a word we know.
 */
const LIGATURE_WORDS = new Set([
  // fi
  "confidence", "confident", "confidential", "scientific", "scientist", "first",
  "find", "finds", "finding", "findings", "fine", "finger", "fingers", "finish",
  "finished", "firm", "firmly", "fight", "fighting", "field", "fields", "figure",
  "figures", "file", "files", "fill", "filled", "film", "final", "finally",
  "financial", "fifty", "fifteen", "fifth", "fix", "fixed", "definite",
  "definitely", "definition", "define", "defined", "benefit", "benefits",
  "significant", "significantly", "significance", "confirm", "confirmed",
  "identify", "identified", "identification", "specific", "specifically",
  "difficult", "difficulty", "difficulties", "sufficient", "sufficiently",
  "efficient", "efficiency", "office", "officer", "officers", "official",
  "artificial", "certificate", "classification", "classified", "justification",
  "justified", "magnificent", "modification", "modified", "notification",
  "pacific", "profit", "profits", "qualified", "satisfied", "satisfying",
  "terrific", "unified", "verified", "verify", "amplified", "beautified",
  "clarify", "clarified", "gratifying", "horrified", "identifies", "notify",
  "prefix", "profile", "profiles", "refine", "refined", "selfish", "superficial",
  "testify", "unfit", "fiction", "fifty", "figurative", "filter", "finance",
  "fiscal", "fitness", "fitting", "firsthand", "firefighter",
  // fl
  "flat", "flag", "flame", "flash", "flat", "flavor", "flesh", "flight",
  "flights", "float", "floating", "flood", "floor", "floors", "flow", "flowing",
  "flower", "flowers", "fluid", "fly", "flying", "reflect", "reflected",
  "reflection", "reflex", "influence", "influenced", "conflict", "conflicts",
  "inflation", "inflict", "overflow", "reflects", "fluent", "fluctuate",
  // ff
  "effort", "efforts", "effect", "effects", "effective", "effectively",
  "efficacy", "offer", "offers", "offered", "offering", "different",
  "difference", "differences", "differently", "differ", "suffer", "suffered",
  "suffering", "buffer", "coffee", "affair", "affairs", "affect", "affected",
  "afford", "office", "offices", "staff", "stuff", "traffic", "affirm",
  "affirmation", "diffuse", "sniff", "stiff", "cliff", "off",
  // ffi / ffl
  "difficulties", "sufficiency", "shuffle", "shuffled", "baffle", "baffled"
]);

/**
 * Short words that must never be "repaired" into something longer. Without
 * this, "the at surface" becomes "the flat surface".
 */
const NEVER_EXTEND = new Set([
  "a", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it",
  "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we", "am", "and",
  "the", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her",
  "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "its",
  "new", "now", "old", "see", "two", "way", "who", "did", "may", "say", "she",
  "too", "use", "own", "end", "far", "few", "let", "put", "run", "set", "ten",
  "top", "try", "why", "yes", "yet", "ill", "off", "over", "life", "like"
]);

/** Words that legitimately follow a dangling hyphen in English. */
const SUSPENDED_HYPHEN_FOLLOWERS = new Set([
  "or", "and", "nor", "but", "to", "through", "versus", "vs"
]);

/**
 * Rejoin words split by a hyphen plus a space.
 *
 * Typeset books hyphenate at the right margin; ebook conversions often
 * bake that break into the text itself, so "Logother- apy" arrives inside
 * a single run and never passes through the line-joining logic. Genuine
 * suspended hyphens ("third- or fourth-") are left alone, identified by
 * the conjunction that follows them.
 */
export function repairHyphenation(text: string): string {
  // PDFs use several dash characters interchangeably: ASCII hyphen-minus,
  // U+2010 hyphen, U+2011 non-breaking hyphen, and the soft hyphen.
  return text.replace(
    /([A-Za-z]{2,})[-\u2010\u2011\u00ad] ([a-z]{2,})/g,
    (whole, head: string, tail: string) =>
      SUSPENDED_HYPHEN_FOLLOWERS.has(tail.toLowerCase()) ? whole : head + tail
  );
}

/**
 * Restore ligatures that decoded to a space.
 *
 * Some PDFs embed fi/fl/ff as a single glyph with no Unicode mapping;
 * pdf.js then emits a space, so "confidence" arrives as "con dence" and
 * "first" as " rst". Both halves are rejoined only when the result is a
 * word we recognise, which keeps ordinary spacing untouched.
 */
export function repairLigatures(text: string): string {
  // Tokenise rather than regex-replace. A global replace consumes each
  // match, so scanning "my con dence" pairs "my"+"con" and never gets to
  // test "con"+"dence" - the very case this exists to fix.
  const parts = text.split(/(\s+)/); // keeps the separators

  // Fragments arrive wrapped in punctuation: "(con" and "dence." Split
  // each token into its leading punctuation, letters, and trailing
  // punctuation so the letters can be tested and then put back.
  const shell = (t: string) => {
    const m = t.match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/);
    return m ? { pre: m[1], core: m[2], post: m[3] } : null;
  };

  for (let i = 0; i + 2 < parts.length; i++) {
    if (parts[i + 1] !== " ") continue;
    const A = shell(parts[i]);
    const B = shell(parts[i + 2]);
    if (!A || !B) continue;
    // Only a clean break counts: "con" + "dence." not "con," + "dence".
    if (A.post !== "" || B.pre !== "") continue;
    if (NEVER_EXTEND.has(B.core.toLowerCase())) continue;
    for (const lig of LIGATURES) {
      const joined = A.core + lig + B.core;
      if (LIGATURE_WORDS.has(joined.toLowerCase())) {
        parts[i] = A.pre + joined + B.post;
        parts[i + 1] = "";
        parts[i + 2] = "";
        i += 2;
        break;
      }
    }
  }

  // A ligature at the start of a word leaves a stray gap before it:
  // "the rst part". Only rebuild when the fragment is not itself a word.
  for (let i = 0; i < parts.length; i++) {
    const P = shell(parts[i]);
    if (!P) continue;
    const w = P.core.toLowerCase();
    if (NEVER_EXTEND.has(w) || LIGATURE_WORDS.has(w)) continue;
    for (const lig of LIGATURES) {
      if (LIGATURE_WORDS.has(lig + w)) {
        parts[i] = P.pre + lig + P.core + P.post;
        break;
      }
    }
  }

  return parts.join("").replace(/ {2,}/g, " ");
}

/** Everything that has to happen before the text can be trusted. */
export function repairExtractedText(text: string): string {
  return repairLigatures(repairHyphenation(text));
}
