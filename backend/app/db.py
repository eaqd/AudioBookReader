from collections.abc import AsyncIterator
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Integer, String, Text, select
from sqlalchemy.ext.asyncio import (
    AsyncAttrs,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .config import settings


class Base(AsyncAttrs, DeclarativeBase):
    pass


class Book(Base):
    __tablename__ = "books"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String)
    author: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    cover_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    voice: Mapped[str] = mapped_column(String, default=settings.default_voice)
    total_duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    total_chars: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String, default="processing")  # processing|ready|failed
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    sections: Mapped[list["Section"]] = relationship(
        back_populates="book", cascade="all, delete-orphan", order_by="Section.idx"
    )
    chunks: Mapped[list["Chunk"]] = relationship(
        back_populates="book", cascade="all, delete-orphan", order_by="Chunk.idx"
    )
    progress: Mapped[Optional["Progress"]] = relationship(
        back_populates="book", uselist=False, cascade="all, delete-orphan"
    )


class Section(Base):
    __tablename__ = "sections"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    book_id: Mapped[str] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"))
    idx: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    start_chunk_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    book: Mapped[Book] = relationship(back_populates="sections")


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    book_id: Mapped[str] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"))
    section_id: Mapped[str] = mapped_column(ForeignKey("sections.id", ondelete="CASCADE"))
    idx: Mapped[int] = mapped_column(Integer)             # global order within book
    section_idx: Mapped[int] = mapped_column(Integer)     # order within section
    text: Mapped[str] = mapped_column(Text)
    audio_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    words_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    book: Mapped[Book] = relationship(back_populates="chunks")


class Progress(Base):
    __tablename__ = "progress"

    book_id: Mapped[str] = mapped_column(
        ForeignKey("books.id", ondelete="CASCADE"), primary_key=True
    )
    chunk_id: Mapped[str] = mapped_column(String)
    offset_ms: Mapped[int] = mapped_column(Integer, default=0)
    word_idx: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    book: Mapped[Book] = relationship(back_populates="progress")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    book_id: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued")  # queued|running|done|failed
    progress: Mapped[int] = mapped_column(Integer, default=0)
    current_step: Mapped[str] = mapped_column(String, default="queued")
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


engine = create_async_engine(settings.resolved_db_url, echo=False, future=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


__all__ = [
    "Base",
    "Book",
    "Section",
    "Chunk",
    "Progress",
    "Job",
    "engine",
    "SessionLocal",
    "init_db",
    "get_session",
    "select",
]
