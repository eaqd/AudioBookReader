from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class WordTime(BaseModel):
    w: str             # word text
    s: float           # start (seconds)
    e: float           # end (seconds)
    cs: int            # char start in chunk text
    ce: int            # char end in chunk text
    unstable: bool = False


class ChunkOut(BaseModel):
    id: str
    book_id: str
    section_id: str
    idx: int
    section_idx: int
    text: str
    audio_url: str
    duration_ms: int
    words: list[WordTime]


class ChunkIndexEntry(BaseModel):
    id: str
    section_id: str
    idx: int
    section_idx: int
    duration_ms: int
    char_count: int


class SectionOut(BaseModel):
    id: str
    idx: int
    title: str
    duration_ms: int
    start_chunk_id: Optional[str]


class BookSummary(BaseModel):
    id: str
    title: str
    author: Optional[str] = None
    cover_url: Optional[str] = None
    voice: str
    total_duration_ms: int
    total_chars: int
    status: str
    created_at: datetime


class BookDetail(BookSummary):
    sections: list[SectionOut]
    chunks: list[ChunkIndexEntry]
    error: Optional[str] = None


class ProgressIn(BaseModel):
    chunk_id: str
    offset_ms: int = Field(ge=0)
    word_idx: int = Field(ge=0)


class ProgressOut(ProgressIn):
    book_id: str
    updated_at: datetime


class JobStatus(BaseModel):
    id: str
    book_id: str
    status: str
    progress: int
    current_step: str
    message: Optional[str] = None


class UploadResponse(BaseModel):
    book_id: str
    job_id: str


class ManifestEntry(BaseModel):
    chunk_id: str
    audio_url: str
    duration_ms: int


class BookManifest(BaseModel):
    book_id: str
    voice: str
    total_duration_ms: int
    chunks: list[ManifestEntry]
