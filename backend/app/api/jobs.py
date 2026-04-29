from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from ..db import Job, SessionLocal, get_session
from ..schemas import JobStatus

router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobStatus)
async def get_job(job_id: str, s: AsyncSession = Depends(get_session)) -> JobStatus:
    job = await s.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    return JobStatus(
        id=job.id, book_id=job.book_id, status=job.status,
        progress=job.progress, current_step=job.current_step, message=job.message,
    )


@router.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str):
    async def gen():
        last: tuple[int, str, str] | None = None
        while True:
            async with SessionLocal() as s:
                job = await s.get(Job, job_id)
            if job is None:
                yield {"event": "error", "data": json.dumps({"error": "not found"})}
                return
            payload = {
                "id": job.id,
                "book_id": job.book_id,
                "status": job.status,
                "progress": job.progress,
                "current_step": job.current_step,
                "message": job.message,
            }
            sig = (job.progress, job.status, job.current_step)
            if sig != last:
                yield {"event": "progress", "data": json.dumps(payload)}
                last = sig
            if job.status in ("done", "failed"):
                return
            await asyncio.sleep(0.5)

    return EventSourceResponse(gen())
