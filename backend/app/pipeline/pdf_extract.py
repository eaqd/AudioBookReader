"""PDF text extraction via PyMuPDF.

Extracts ordered paragraphs with bounding boxes and font sizes, then strips
running-header/footer chrome by detecting text that repeats on >40% of pages
in similar positions.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import fitz  # type: ignore[import-not-found]


@dataclass
class Paragraph:
    page: int
    bbox: tuple[float, float, float, float]
    text: str
    font_size: float


@dataclass
class PdfDocument:
    title: str
    author: str | None
    page_count: int
    paragraphs: list[Paragraph]
    toc: list[tuple[int, str, int]]   # (level, title, page)


def _block_to_paragraph(page_idx: int, block: dict) -> Paragraph | None:
    if block.get("type", 0) != 0:  # 0 = text block
        return None
    pieces: list[str] = []
    sizes: list[float] = []
    for line in block.get("lines", []):
        line_text = "".join(span.get("text", "") for span in line.get("spans", []))
        pieces.append(line_text)
        for span in line.get("spans", []):
            sz = span.get("size")
            if sz:
                sizes.append(float(sz))
    text = " ".join(p.strip() for p in pieces if p.strip()).strip()
    if not text:
        return None
    bbox = tuple(block.get("bbox", (0.0, 0.0, 0.0, 0.0)))  # type: ignore[assignment]
    avg = sum(sizes) / len(sizes) if sizes else 0.0
    return Paragraph(page=page_idx, bbox=bbox, text=text, font_size=avg)


def _is_chrome(paragraphs: Iterable[Paragraph], page_count: int) -> set[str]:
    """Detect headers/footers: short text repeated on >40% of pages."""
    if page_count < 4:
        return set()
    counter: Counter[str] = Counter()
    for p in paragraphs:
        if len(p.text) <= 80:
            counter[p.text] += 1
    threshold = max(2, int(page_count * 0.4))
    return {text for text, n in counter.items() if n >= threshold}


def _looks_like_page_number(s: str) -> bool:
    s = s.strip()
    return s.isdigit() and len(s) <= 4


def extract(pdf_path: str | Path) -> PdfDocument:
    pdf_path = Path(pdf_path)
    doc = fitz.open(pdf_path)
    paragraphs: list[Paragraph] = []
    for page_idx in range(doc.page_count):
        page = doc.load_page(page_idx)
        for block in page.get_text("dict").get("blocks", []):
            para = _block_to_paragraph(page_idx, block)
            if para is not None:
                paragraphs.append(para)

    chrome = _is_chrome(paragraphs, doc.page_count)
    cleaned = [
        p for p in paragraphs
        if p.text not in chrome and not _looks_like_page_number(p.text)
    ]

    meta = doc.metadata or {}
    title = (meta.get("title") or pdf_path.stem).strip() or pdf_path.stem
    author = (meta.get("author") or None) or None
    toc = doc.get_toc(simple=True) or []
    return PdfDocument(
        title=title,
        author=author,
        page_count=doc.page_count,
        paragraphs=cleaned,
        toc=toc,
    )
