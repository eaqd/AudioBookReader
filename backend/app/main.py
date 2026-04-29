from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api import audio as audio_routes
from .api import books as book_routes
from .api import jobs as job_routes
from .api import progress as progress_routes
from .config import settings
from .db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="PDF Audiobook Reader", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)

app.include_router(book_routes.router)
app.include_router(audio_routes.router)
app.include_router(progress_routes.router)
app.include_router(job_routes.router)

# Optional: serve covers directly
covers_dir = settings.storage_dir / "covers"
covers_dir.mkdir(parents=True, exist_ok=True)
app.mount("/covers", StaticFiles(directory=str(covers_dir)), name="covers")


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "version": "0.1.0"}
