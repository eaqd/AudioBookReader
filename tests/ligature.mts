import { repairExtractedText } from "../lib/pdf/repair";
const cases: [string, string][] = [
  ["I tried to take one of the old prisoners into my con dence.", "confidence"],
  ["the manuscript of a scienti c book", "scientific"],
  ["distill from the rst part", "first"],
  ["(“Logother- apy in a Nutshell”)", "Logotherapy"],
  ["in pur- suit of", "pursuit"],
  ["mate- rial and prison- ers", "material"],
  ["a dif cult sabo- tage", "difficult"],
];
let bad = 0;
for (const [input, expect] of cases) {
  const out = repairExtractedText(input);
  const ok = out.includes(expect);
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(out)}`);
}
// must NOT corrupt ordinary text
const safe = [
  "the at surface of the table",
  "third- or fourth-level",
  "Democrat- and Republican-led",
  "he was in the office at five",
];
for (const t of safe) {
  const out = repairExtractedText(t);
  const ok = out === t;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  unchanged: ${JSON.stringify(out)}`);
}
console.log(bad === 0 ? "\nALL PASS" : `\n${bad} FAILING`);
process.exit(bad === 0 ? 0 : 1);
