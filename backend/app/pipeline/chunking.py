"""Sentence chunking.

We split section text into chunks of 1-3 sentences, hard cap 400 chars.
Math, code, and table-ish runs are stripped from the audio chunk text but
preserved in the visual text payload (caller responsibility).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Compact sentence tokenizer: avoids the nltk dependency.
_SENT_BOUNDARY = re.compile(r"(?<=[\.\!\?])\s+(?=[A-Z\"\'\(\[])")
_LATEX_INLINE = re.compile(r"\$[^$]{1,200}\$")
_LATEX_BLOCK = re.compile(r"\\\[[^\]]{1,500}\\\]|\\\(.+?\\\)|\\begin\{.+?\}.*?\\end\{.+?\}", re.DOTALL)
_CODE_FENCE = re.compile(r"```.*?```", re.DOTALL)
_HEAVY_PUNCT = re.compile(r"[│┃┄┈─━]+")


@dataclass
class TextChunk:
    text: str          # cleaned text used for both display & TTS
    char_start: int    # offset in section's joined paragraph text


def _clean_for_speech(s: str) -> str:
    s = _CODE_FENCE.sub(" ", s)
    s = _LATEX_BLOCK.sub(" ", s)
    s = _LATEX_INLINE.sub(" ", s)
    s = _HEAVY_PUNCT.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _split_sentences(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    parts = _SENT_BOUNDARY.split(text)
    return [p.strip() for p in parts if p.strip()]


def chunk_section(section_text: str, max_chars: int = 400, max_sentences: int = 3) -> list[TextChunk]:
    cleaned = _clean_for_speech(section_text)
    sentences = _split_sentences(cleaned)
    chunks: list[TextChunk] = []
    cursor = 0  # char offset into cleaned section text
    buf: list[str] = []
    buf_start = 0

    def flush() -> None:
        nonlocal buf, buf_start
        if buf:
            text = " ".join(buf).strip()
            if text:
                chunks.append(TextChunk(text=text, char_start=buf_start))
            buf = []

    for sent in sentences:
        # find sentence in remaining text to track offset
        idx = cleaned.find(sent, cursor)
        if idx == -1:
            idx = cursor
        if not buf:
            buf_start = idx

        prospective = (" ".join(buf + [sent])).strip()
        if buf and (len(prospective) > max_chars or len(buf) >= max_sentences):
            flush()
            buf_start = idx
            buf = [sent]
        else:
            buf.append(sent)

        cursor = idx + len(sent)

        # Hard split: a single sentence longer than max_chars
        while len(" ".join(buf)) > max_chars and len(buf) == 1:
            big = buf[0]
            split_at = big.rfind(" ", 0, max_chars)
            if split_at <= 0:
                split_at = max_chars
            chunks.append(TextChunk(text=big[:split_at].strip(), char_start=buf_start))
            buf_start += split_at + 1
            buf = [big[split_at:].strip()]
    flush()
    return chunks
