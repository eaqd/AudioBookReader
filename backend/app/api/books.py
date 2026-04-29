from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import Book, Chunk, Job, Section, get_session
from ..pipeline.ingest import run_ingest
from ..schemas import (
    BookDetail,
    BookManifest,
    BookSummary,
    ChunkIndexEntry,
    ChunkOut,
    ManifestEntry,
    SectionOut,
    UploadResponse,
    WordTime,
)

router = APIRouter()


def _audio_url(book_id: str, chunk_id: str) -> str:
    return f"/audio/{book_id}/{chunk_id}.mp3"


def _book_to_summary(b: Book) -> BookSummary:
    return BookSummary(
        id=b.id,
        title=b.title,
        author=b.author,
        cover_url=f"/covers/{b.id}.png" if b.cover_path else None,
        voice=b.voice,
        total_duration_ms=b.total_duration_ms,
        total_chars=b.total_chars,
        status=b.status,
        created_at=b.created_at,
    )


@router.post("/books/upload", response_model=UploadResponse)
async def upload_book(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    voice: str = Form(default=settings.default_voice),
    title: str | None = Form(default=None),
    s: AsyncSession = Depends(get_session),
) -> UploadResponse:
    if voice not in settings.available_voices:
        raise HTTPException(400, f"unknown voice {voice}")
    if file.content_type not in ("application/pdf", "application/octet-stream") and \
       not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "expected a PDF")

    book_id = f"bk_{uuid.uuid4().hex[:10]}"
    job_id = f"job_{uuid.uuid4().hex[:10]}"
    upload_dir = settings.storage_dir / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = upload_dir / f"{book_id}.pdf"
    with pdf_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    s.add(Book(
        id=book_id,
        title=title or (file.filename or "Untitled").rsplit(".", 1)[0],
        voice=voice,
        status="processing",
    ))
    s.add(Job(
        id=job_id,
        book_id=book_id,
        status="queued",
        progress=0,
        current_step="queued",
        updated_at=datetime.utcnow(),
    ))
    await s.commit()

    if settings.use_arq:
        # Enqueue via arq pool — done in main.py at import time
        from ..workers.arq_worker import enqueue_ingest
        await enqueue_ingest(book_id, job_id, str(pdf_path), voice)
    else:
        # In-process fallback
        background.add_task(run_ingest, book_id, job_id, str(pdf_path), voice)

    return UploadResponse(book_id=book_id, job_id=job_id)


@router.get("/books", response_model=list[BookSummary])
async def list_books(s: AsyncSession = Depends(get_session)) -> list[BookSummary]:
    res = await s.execute(select(Book).order_by(Book.created_at.desc()))
    return [_book_to_summary(b) for b in res.scalars()]


@router.get("/books/{book_id}", response_model=BookDetail)
async def get_book(book_id: str, s: AsyncSession = Depends(get_session)) -> BookDetail:
    book = await s.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "book not found")
    sec_res = await s.execute(
        select(Section).where(Section.book_id == book_id).order_by(Section.idx)
    )
    sections = [
        SectionOut(
            id=sec.id,
            idx=sec.idx,
            title=sec.title,
            duration_ms=sec.duration_ms,
            start_chunk_id=sec.start_chunk_id,
        )
        for sec in sec_res.scalars()
    ]
    chunk_res = await s.execute(
        select(Chunk).where(Chunk.book_id == book_id).order_by(Chunk.idx)
    )
    chunks = [
        ChunkIndexEntry(
            id=ck.id,
            section_id=ck.section_id,
            idx=ck.idx,
            section_idx=ck.section_idx,
            duration_ms=ck.duration_ms,
            char_count=len(ck.text),
        )
        for ck in chunk_res.scalars()
    ]
    summary = _book_to_summary(book).model_dump()
    return BookDetail(**summary, sections=sections, chunks=chunks, error=book.error)


@router.get("/books/{book_id}/chunks/{chunk_id}", response_model=ChunkOut)
async def get_chunk(
    book_id: str, chunk_id: str, s: AsyncSession = Depends(get_session)
) -> ChunkOut:
    ck = await s.get(Chunk, chunk_id)
    if ck is None or ck.book_id != book_id:
        raise HTTPException(404, "chunk not found")
    words_raw = json.loads(ck.words_json) if ck.words_json else []
    words = [WordTime(**w) for w in words_raw]
    return ChunkOut(
        id=ck.id,
        book_id=ck.book_id,
        section_id=ck.section_id,
        idx=ck.idx,
        section_idx=ck.section_idx,
        text=ck.text,
        audio_url=_audio_url(book_id, ck.id),
        duration_ms=ck.duration_ms,
        words=words,
    )


@router.get("/books/{book_id}/manifest", response_model=BookManifest)
async def get_manifest(
    book_id: str, s: AsyncSession = Depends(get_session)
) -> BookManifest:
    book = await s.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "book not found")
    res = await s.execute(select(Chunk).where(Chunk.book_id == book_id).order_by(Chunk.idx))
    entries = [
        ManifestEntry(
            chunk_id=ck.id,
            audio_url=_audio_url(book_id, ck.id),
            duration_ms=ck.duration_ms,
        )
        for ck in res.scalars()
    ]
    return BookManifest(
        book_id=book_id,
        voice=book.voice,
        total_duration_ms=book.total_duration_ms,
        chunks=entries,
    )


@router.delete("/books/{book_id}")
async def delete_book(book_id: str, s: AsyncSession = Depends(get_session)) -> dict:
    book = await s.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "book not found")
    await s.execute(sa_delete(Book).where(Book.id == book_id))
    await s.commit()
    audio_dir = settings.storage_dir / "audio" / book_id
    if audio_dir.exists():
        shutil.rmtree(audio_dir, ignore_errors=True)
    pdf = settings.storage_dir / "uploads" / f"{book_id}.pdf"
    if pdf.exists():
        pdf.unlink(missing_ok=True)
    return {"deleted": book_id}


@router.get("/voices", response_model=list[str])
async def voices() -> list[str]:
    return settings.available_voices
