/**
 * Browser-side PDF text extraction via pdfjs-dist.
 *
 * Returns paragraph-ish text items with derived font sizes and a normalized
 * outline (TOC) keyed by 1-based page numbers. Detects scanned PDFs and
 * throws ScannedPdfError so callers can surface a friendly error.
 */

import * as pdfjsLib from "pdfjs-dist";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  TextItem,
  TextMarkedContent
} from "pdfjs-dist/types/src/display/api";

// Wire the worker once. We host it from /public so this works in dev and
// on Vercel without webpack worker-loader gymnastics.
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

export interface ExtractedTextItem {
  text: string;
  fontSize: number;
  /** y-coordinate in PDF user space (origin bottom-left). */
  y: number;
  /** x-coordinate of the first glyph. Useful for column detection later. */
  x: number;
  /** Advance width of this run in text space. Used to detect the gaps
   *  where pdf.js dropped a space between adjacent style runs. */
  width: number;
}

export interface ExtractedPage {
  pageNumber: number; // 1-based
  items: ExtractedTextItem[];
}

export interface ExtractedOutlineEntry {
  title: string;
  pageNumber: number; // 1-based
}

export interface ExtractedDoc {
  title: string;
  pageCount: number;
  pages: ExtractedPage[];
  outline: ExtractedOutlineEntry[] | null;
}

export class ScannedPdfError extends Error {
  constructor(message = "This PDF appears to be scanned images. OCR is not supported in v1.") {
    super(message);
    this.name = "ScannedPdfError";
  }
}

/** Avg chars/page below this for ≥3 pages → treat as scanned. */
const SCANNED_THRESHOLD_CHARS_PER_PAGE = 50;

export async function extract(file: File): Promise<ExtractedDoc> {
  const buf = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const pdf: PDFDocumentProxy = await loadingTask.promise;

  const meta = await pdf.getMetadata().catch(() => null);
  const titleFromMeta =
    (meta?.info as { Title?: string } | undefined)?.Title?.trim() || null;
  const titleFromFile = file.name.replace(/\.pdf$/i, "");
  const title = titleFromMeta && titleFromMeta.length > 0 ? titleFromMeta : titleFromFile;

  const pages: ExtractedPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    pages.push(await extractPage(pdf, i));
  }

  // Scanned PDF detection.
  const totalChars = pages.reduce(
    (sum, p) => sum + p.items.reduce((s, it) => s + it.text.length, 0),
    0
  );
  const avg = pdf.numPages > 0 ? totalChars / pdf.numPages : 0;
  if (pdf.numPages >= 3 && avg < SCANNED_THRESHOLD_CHARS_PER_PAGE) {
    throw new ScannedPdfError();
  }

  const outline = await readOutline(pdf);

  return {
    title,
    pageCount: pdf.numPages,
    pages,
    outline
  };
}

async function extractPage(pdf: PDFDocumentProxy, pageNumber: number): Promise<ExtractedPage> {
  const page: PDFPageProxy = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const items: ExtractedTextItem[] = [];
  for (const raw of content.items as Array<TextItem | TextMarkedContent>) {
    if (!("str" in raw)) continue;
    const str = raw.str;
    if (!str) continue;
    // transform: [a, b, c, d, e, f] — affine matrix; e/f are tx/ty.
    const t = raw.transform;
    const x = Array.isArray(t) ? t[4] : 0;
    const y = Array.isArray(t) ? t[5] : 0;
    // Font size ≈ |d| (vertical scale). Falls back to height if needed.
    const fontSize = Array.isArray(t) ? Math.abs(t[3]) : raw.height || 0;
    const width = typeof raw.width === "number" ? raw.width : 0;
    items.push({ text: str, fontSize, y, x, width });
    if (raw.hasEOL) {
      items.push({ text: "\n", fontSize, y, x, width: 0 });
    }
  }
  return { pageNumber, items };
}

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>> extends (infer U)[] | null
  ? U
  : never;

async function readOutline(pdf: PDFDocumentProxy): Promise<ExtractedOutlineEntry[] | null> {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline || outline.length === 0) return null;

  const flat: ExtractedOutlineEntry[] = [];

  async function walk(nodes: OutlineNode[]): Promise<void> {
    for (const node of nodes) {
      const pageNumber = await resolvePage(pdf, node.dest);
      if (pageNumber != null) {
        flat.push({ title: (node.title || "").trim(), pageNumber });
      }
      if (node.items?.length) await walk(node.items);
    }
  }

  await walk(outline);
  return flat.length > 0 ? flat : null;
}

async function resolvePage(
  pdf: PDFDocumentProxy,
  dest: string | unknown[] | null | undefined
): Promise<number | null> {
  try {
    let target: unknown[] | null = null;
    if (typeof dest === "string") {
      const resolved = await pdf.getDestination(dest);
      target = Array.isArray(resolved) ? resolved : null;
    } else if (Array.isArray(dest)) {
      target = dest;
    }
    if (!target || target.length === 0) return null;
    const ref = target[0];
    const pageIndex = await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
    return pageIndex + 1;
  } catch {
    return null;
  }
}
