from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import Book, Progress, get_session
from ..schemas import ProgressIn, ProgressOut

router = APIRouter()


@router.put("/books/{book_id}/progress", response_model=ProgressOut)
async def put_progress(
    book_id: str, body: ProgressIn, s: AsyncSession = Depends(get_session)
) -> ProgressOut:
    book = await s.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "book not found")
    p = await s.get(Progress, book_id)
    now = datetime.utcnow()
    if p is None:
        p = Progress(
            book_id=book_id, chunk_id=body.chunk_id,
            offset_ms=body.offset_ms, word_idx=body.word_idx, updated_at=now,
        )
        s.add(p)
    else:
        p.chunk_id = body.chunk_id
        p.offset_ms = body.offset_ms
        p.word_idx = body.word_idx
        p.updated_at = now
    await s.commit()
    return ProgressOut(
        book_id=book_id, chunk_id=p.chunk_id,
        offset_ms=p.offset_ms, word_idx=p.word_idx, updated_at=p.updated_at,
    )


@router.get("/books/{book_id}/progress", response_model=ProgressOut | None)
async def get_progress(
    book_id: str, s: AsyncSession = Depends(get_session)
) -> ProgressOut | None:
    p = await s.get(Progress, book_id)
    if p is None:
        return None
    return ProgressOut(
        book_id=book_id, chunk_id=p.chunk_id,
        offset_ms=p.offset_ms, word_idx=p.word_idx, updated_at=p.updated_at,
    )
