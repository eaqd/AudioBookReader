"""Section detection.

Strategy:
  1. Use PDF TOC if it has >= 3 entries.
  2. Heading heuristic: paragraphs where font_size > 1.3 * median AND text < 100 chars.
  3. Fallback: every 3000 words.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median

from .pdf_extract import Paragraph, PdfDocument


@dataclass
class SectionSpan:
    idx: int
    title: str
    paragraphs: list[Paragraph]


def _split_by_indices(paras: list[Paragraph], heading_indices: list[int],
                      titles: list[str]) -> list[SectionSpan]:
    sections: list[SectionSpan] = []
    if not heading_indices:
        return [SectionSpan(idx=0, title="Body", paragraphs=paras)]
    # Add a sentinel end
    bounds = list(heading_indices) + [len(paras)]
    for sec_idx, (start, end) in enumerate(zip(heading_indices, bounds[1:], strict=False)):
        # Skip the heading paragraph itself in body content
        body = paras[start + 1:end]
        title = titles[sec_idx] if sec_idx < len(titles) else paras[start].text
        sections.append(SectionSpan(idx=sec_idx, title=title.strip()[:200], paragraphs=body))
    return sections


def _toc_sections(doc: PdfDocument) -> list[SectionSpan] | None:
    toc = doc.toc
    if len(toc) < 3:
        return None
    # Map paragraph index → page. Sections start at first paragraph on/after page-1
    # of the TOC entry.
    para_pages = [p.page for p in doc.paragraphs]
    heading_indices: list[int] = []
    titles: list[str] = []
    for _level, title, page in toc:
        target = max(0, page - 1)
        # find first paragraph at or after this page
        idx = next((i for i, pg in enumerate(para_pages) if pg >= target), None)
        if idx is None:
            continue
        if heading_indices and idx <= heading_indices[-1]:
            continue
        heading_indices.append(idx)
        titles.append(title)
    if len(heading_indices) < 3:
        return None
    return _split_by_indices(doc.paragraphs, heading_indices, titles)


def _heading_heuristic(paras: list[Paragraph]) -> list[SectionSpan] | None:
    sizes = [p.font_size for p in paras if p.font_size > 0]
    if len(sizes) < 10:
        return None
    med = median(sizes)
    threshold = med * 1.3
    heading_indices: list[int] = []
    titles: list[str] = []
    for i, p in enumerate(paras):
        if (
            p.font_size >= threshold
            and len(p.text) < 100
            and len(p.text.split()) <= 14
            and any(c.isalpha() for c in p.text)
        ):
            if heading_indices and i - heading_indices[-1] < 2:
                continue
            heading_indices.append(i)
            titles.append(p.text)
    if len(heading_indices) < 3:
        return None
    return _split_by_indices(paras, heading_indices, titles)


def _word_split(paras: list[Paragraph], max_words: int = 3000) -> list[SectionSpan]:
    sections: list[SectionSpan] = []
    cur: list[Paragraph] = []
    word_count = 0
    sec_idx = 0
    for p in paras:
        cur.append(p)
        word_count += len(p.text.split())
        if word_count >= max_words:
            sections.append(SectionSpan(idx=sec_idx, title=f"Part {sec_idx + 1}", paragraphs=cur))
            sec_idx += 1
            cur = []
            word_count = 0
    if cur:
        sections.append(SectionSpan(idx=sec_idx, title=f"Part {sec_idx + 1}", paragraphs=cur))
    if not sections:
        sections.append(SectionSpan(idx=0, title="Body", paragraphs=paras))
    return sections


def detect_sections(doc: PdfDocument) -> list[SectionSpan]:
    return _toc_sections(doc) or _heading_heuristic(doc.paragraphs) or _word_split(doc.paragraphs)
