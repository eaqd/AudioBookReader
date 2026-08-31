/**
 * Emits a tiny, valid single-page PDF with a few sentences of text.
 * Used as a fixture for the end-to-end browser test — avoids depending
 * on any book being present on the machine.
 */
import { writeFileSync } from "node:fs";

const lines = [
  "Chapter One",
  "The quick brown fox jumps over the lazy dog.",
  "This sentence exists so the reader has something to say out loud.",
  "Speech synthesis should move from one sentence to the next by itself.",
  "A hyphen- ated word tests the line rejoining logic."
];

// Build the content stream: one Td-positioned line per row.
let content = "BT\n/F1 14 Tf\n72 720 Td\n16 TL\n";
for (const l of lines) {
  const esc = l.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  content += `(${esc}) Tj T*\n`;
}
content += "ET";

const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
];

let pdf = "%PDF-1.4\n";
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});

const xrefStart = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) {
  pdf += String(off).padStart(10, "0") + " 00000 n \n";
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = process.argv[2] || "test-book.pdf";
writeFileSync(out, pdf, "latin1");
console.log(`wrote ${out} (${pdf.length} bytes, ${lines.length} lines)`);
