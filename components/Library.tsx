"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CoverArt } from "@/components/CoverArt";
import { listBooks } from "@/lib/storage/books";
import { loadProgress } from "@/lib/storage/progress";
import type { BookRow } from "@/lib/storage/db";

interface BookWithProgress extends BookRow {
  progressPct: number;
}

export function Library() {
  const [books, setBooks] = useState<BookWithProgress[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await listBooks();
        const withProgress = await Promise.all(
          rows.map(async (b) => {
            const p = await loadProgress(b.id);
            const pct = p ? estimatePct(b, p.chapterId, p.sentenceIdx) : 0;
            return { ...b, progressPct: pct };
          })
        );
        if (alive) setBooks(withProgress);
      } catch {
        if (alive) setBooks([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (books === null) {
    return <p className="text-sm text-muted px-1">Loading your library…</p>;
  }

  if (books.length === 0) {
    return null;
  }

  const continueListening = books.find((b) => b.progressPct > 0 && b.progressPct < 99);

  return (
    <div className="space-y-8">
      {continueListening && <ContinueRow book={continueListening} />}
      <section>
        <div className="flex items-end justify-between mb-3">
          <h2 className="text-xl font-bold tracking-tight">Your library</h2>
          <span className="text-xs text-muted">
            {books.length} {books.length === 1 ? "book" : "books"}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-6">
          {books.map((b) => (
            <BookCard key={b.id} book={b} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ContinueRow({ book }: { book: BookWithProgress }) {
  return (
    <Link
      href={`/reader/${book.id}`}
      className="group block rounded-2xl bg-card hover:bg-cardHover transition p-4 sm:p-5 shadow-card"
    >
      <div className="flex items-center gap-4">
        <CoverArt title={book.title} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted">
            Continue listening
          </p>
          <p className="text-base font-semibold truncate mt-0.5">{book.title}</p>
          <div className="mt-2 h-1 rounded-full bg-line overflow-hidden">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.min(100, Math.max(2, book.progressPct))}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-subtle tabular-nums">
            {book.progressPct.toFixed(0)}% · {book.chapterCount} chapters
          </p>
        </div>
        <span className="h-12 w-12 shrink-0 rounded-full grid place-items-center bg-accent text-black group-hover:bg-accentHover transition">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="M8 5v14l11-7z" />
          </svg>
        </span>
      </div>
    </Link>
  );
}

function BookCard({ book }: { book: BookWithProgress }) {
  return (
    <Link
      href={`/reader/${book.id}`}
      className="group block rounded-xl p-2 -m-2 hover:bg-cardHover transition"
    >
      <div className="relative">
        <CoverArt title={book.title} size="md" className="!h-auto !w-full aspect-square !rounded-lg" />
        {book.progressPct > 0 && (
          <div className="absolute bottom-0 inset-x-0 h-1 bg-black/40">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.min(100, book.progressPct)}%` }}
            />
          </div>
        )}
      </div>
      <p className="mt-2 text-sm font-semibold truncate">{book.title}</p>
      <p className="text-[11px] text-muted">
        {book.chapterCount} chapters · {book.pageCount} pages
      </p>
    </Link>
  );
}

function estimatePct(book: BookRow, chapterId: string, sentenceIdx: number): number {
  // We don't know exact sentence indices without the content payload, so
  // estimate by chapter ordering. Cheap, good enough for a card.
  const chIdx = parseInt(chapterId.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(chIdx) || book.chapterCount <= 0) return 0;
  const base = (chIdx - 1) / book.chapterCount;
  const within = Math.min(1, sentenceIdx / Math.max(1, book.sentenceCount / book.chapterCount));
  const pct = (base + within / book.chapterCount) * 100;
  return Math.max(0, Math.min(100, pct));
}
