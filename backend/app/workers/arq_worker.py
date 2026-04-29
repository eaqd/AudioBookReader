"""Arq worker: ingest jobs run here when ABR_USE_ARQ=true.

Run alongside the API:
    arq app.workers.arq_worker.WorkerSettings
"""

from __future__ import annotations

from arq import create_pool
from arq.connections import RedisSettings

from ..config import settings
from ..db import init_db
from ..pipeline.ingest import run_ingest

_pool = None


def _redis() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


async def ingest_task(ctx: dict, book_id: str, job_id: str, pdf_path: str, voice: str) -> None:
    await run_ingest(book_id, job_id, pdf_path, voice)


async def startup(ctx: dict) -> None:
    await init_db()


class WorkerSettings:
    functions = [ingest_task]
    redis_settings = _redis()
    on_startup = startup
    job_timeout = 60 * 60 * 6  # 6h for very long books
    max_jobs = 1                # serialize on a single CPU TTS box


async def get_pool():
    global _pool
    if _pool is None:
        _pool = await create_pool(_redis())
    return _pool


async def enqueue_ingest(book_id: str, job_id: str, pdf_path: str, voice: str) -> None:
    pool = await get_pool()
    await pool.enqueue_job("ingest_task", book_id, job_id, pdf_path, voice)
