"""Range-aware audio file serving (mandatory for iOS Safari)."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse

from ..config import settings

router = APIRouter()


def _resolve_audio(book_id: str, chunk_id: str) -> Path:
    base = (settings.storage_dir / "audio" / book_id).resolve()
    target = (base / f"{chunk_id}.mp3").resolve()
    # prevent path traversal
    if not str(target).startswith(str(base)):
        raise HTTPException(400, "invalid path")
    if not target.exists():
        raise HTTPException(404, "audio not found")
    return target


@router.get("/audio/{book_id}/{chunk_id}.mp3")
async def get_audio(
    book_id: str,
    chunk_id: str,
    request: Request,
    range: str | None = Header(default=None),
) -> Response:
    path = _resolve_audio(book_id, chunk_id)
    file_size = os.path.getsize(path)

    if range is None:
        return FileResponse(
            str(path),
            media_type="audio/mpeg",
            headers={"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000"},
        )

    # Parse "bytes=START-END"
    try:
        units, _, rng = range.partition("=")
        if units.strip().lower() != "bytes":
            raise ValueError
        start_s, _, end_s = rng.partition("-")
        start = int(start_s) if start_s else 0
        end = int(end_s) if end_s else file_size - 1
    except ValueError as e:
        raise HTTPException(416, "invalid range") from e

    end = min(end, file_size - 1)
    if start > end or start >= file_size:
        return Response(
            status_code=416,
            headers={"Content-Range": f"bytes */{file_size}"},
        )
    length = end - start + 1

    def iterfile():
        with path.open("rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Cache-Control": "public, max-age=31536000",
    }
    return StreamingResponse(
        iterfile(),
        status_code=206,
        media_type="audio/mpeg",
        headers=headers,
    )
