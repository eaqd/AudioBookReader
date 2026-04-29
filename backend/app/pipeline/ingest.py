"""End-to-end ingest orchestrator.

PDF → extract → section → chunk → TTS → align → persist.
Progress is written to the `jobs` table; the API tails it via SSE.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Awaitable, Callable

from sqlalchemy import select

from ..config import settings
from ..db import Book, Chunk, Job, Progress, Section, SessionLocal
from .alignment import AlignedWord, align
from .chunking import TextChunk, chunk_section
from .pdf_extract import extract
from .sectioning import SectionSpan, detect_sections
from .tts import synthesize

log = logging.getLogger(__name__)


ProgressFn = Callable[[int, str, str | None], Awaitable[None]]


async def _set_job(job_id: str, *, progress: int, step: str, message: str | None = None,
                   status: str | None = None) -> None:
    async with SessionLocal() as s:
        job = await s.get(Job, job_id)
        if job is None:
            return
        job.progress = max(job.progress, progress)
        job.current_step = step
        job.message = message
        job.updated_at = datetime.utcnow()
        if status:
            job.status = status
        await s.commit()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


async def _check_scanned(text_chars: int, page_count: int) -> bool:
    return page_count > 0 and (text_chars / page_count) < 50


async def run_ingest(book_id: str, job_id: str, pdf_path: str, voice: str) -> None:
    """Run the full ingest pipeline."""
    pdf_path_p = Path(pdf_path)
    storage = settings.storage_dir
    audio_dir = storage / "audio" / book_id
    audio_dir.mkdir(parents=True, exist_ok=True)

    try:
        await _set_job(job_id, progress=2, step="extract", status="running")
        doc = extract(pdf_path_p)
        total_chars = sum(len(p.text) for p in doc.paragraphs)
        if await _check_scanned(total_chars, doc.page_count):
            raise RuntimeError(
                "This PDF appears to be scanned images. OCR is not supported in v1."
            )

        async with SessionLocal() as s:
            book = await s.get(Book, book_id)
            if book:
                book.title = doc.title
                book.author = doc.author
                book.total_chars = total_chars
                await s.commit()

        await _set_job(job_id, progress=10, step="section")
        sections: list[SectionSpan] = detect_sections(doc)

        # Persist sections + chunks shells (text only); fill audio + words next.
        all_chunk_specs: list[tuple[str, str, int, int, str]] = []
        # (chunk_id, section_id, global_idx, section_idx, text)

        async with SessionLocal() as s:
            global_idx = 0
            for sec in sections:
                section_id = _new_id("sec")
                section_text = " ".join(p.text for p in sec.paragraphs)
                text_chunks: list[TextChunk] = chunk_section(
                    section_text,
                    max_chars=settings.chunk_max_chars,
                    max_sentences=settings.chunk_max_sentences,
                )
                if not text_chunks:
                    continue
                first_chunk_id = _new_id("ck")
                s.add(Section(
                    id=section_id, book_id=book_id, idx=sec.idx,
                    title=sec.title or f"Section {sec.idx + 1}",
                    duration_ms=0, start_chunk_id=first_chunk_id,
                ))
                for sec_chunk_idx, ch in enumerate(text_chunks):
                    cid = first_chunk_id if sec_chunk_idx == 0 else _new_id("ck")
                    s.add(Chunk(
                        id=cid, book_id=book_id, section_id=section_id,
                        idx=global_idx, section_idx=sec_chunk_idx, text=ch.text,
                        audio_path=None, duration_ms=0, words_json=None,
                    ))
                    all_chunk_specs.append((cid, section_id, global_idx, sec_chunk_idx, ch.text))
                    global_idx += 1
            await s.commit()

        if not all_chunk_specs:
            raise RuntimeError("No text chunks were produced from this PDF.")

        # TTS + alignment per chunk
        total = len(all_chunk_specs)
        for i, (cid, section_id, gidx, sidx, text) in enumerate(all_chunk_specs):
            audio_path = audio_dir / f"{cid}.mp3"
            duration_ms = synthesize(
                text, voice, audio_path, bitrate_kbps=settings.audio_bitrate_kbps
            )
            words: list[AlignedWord] = align(audio_path, text, duration_ms)
            words_payload = [
                {"w": w.w, "s": round(w.s, 3), "e": round(w.e, 3),
                 "cs": w.cs, "ce": w.ce, "unstable": w.unstable}
                for w in words
            ]
            async with SessionLocal() as s:
                ck = await s.get(Chunk, cid)
                if ck is None:
                    continue
                ck.audio_path = str(audio_path.relative_to(storage))
                ck.duration_ms = duration_ms
                ck.words_json = json.dumps(words_payload)
                await s.commit()

            pct = 15 + int(80 * (i + 1) / total)
            await _set_job(
                job_id, progress=pct, step="synthesize",
                message=f"chunk {i + 1}/{total}",
            )

        # Roll up section + book durations
        async with SessionLocal() as s:
            res = await s.execute(select(Chunk).where(Chunk.book_id == book_id))
            chunks = list(res.scalars())
            sec_dur: dict[str, int] = {}
            total_ms = 0
            for ck in chunks:
                sec_dur[ck.section_id] = sec_dur.get(ck.section_id, 0) + ck.duration_ms
                total_ms += ck.duration_ms

            for sid, ms in sec_dur.items():
                sec = await s.get(Section, sid)
                if sec:
                    sec.duration_ms = ms

            book = await s.get(Book, book_id)
            if book:
                book.total_duration_ms = total_ms
                book.status = "ready"

            # Initialize progress at chunk 0, offset 0
            existing = await s.get(Progress, book_id)
            if existing is None and chunks:
                first = min(chunks, key=lambda c: c.idx)
                s.add(Progress(book_id=book_id, chunk_id=first.id, offset_ms=0, word_idx=0))
            await s.commit()

        await _set_job(job_id, progress=100, step="done", status="done")

    except Exception as e:  # noqa: BLE001
        log.exception("Ingest failed for %s", book_id)
        async with SessionLocal() as s:
            book = await s.get(Book, book_id)
            if book:
                book.status = "failed"
                book.error = str(e)
                await s.commit()
        await _set_job(job_id, progress=0, step="error", status="failed", message=str(e))
