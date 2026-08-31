"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CoverArt } from "@/components/CoverArt";
import { listBooks, deleteBook } from "@/lib/storage/books";
import { loadProgress } from "@/lib/storage/progress";
import type { BookRow } from "@/lib/storage/db";

interface BookWithProgress extends BookRow {
  progressPct: number;
  chapterIdx: number;
}

export function Library() {
  const [books, setBooks] = useState<BookWithProgress[] | null>(null);
  const [manage, setManage] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await listBooks();
      const withProgress = await Promise.all(
        rows.map(async (b) => {
          const p = await loadProgress(b.id);
          const chapterIdx = p ? chapterIndexFromId(p.chapterId) : 0;
          return { ...b, progressPct: estimatePct(b, chapterIdx), chapterIdx };
        })
      );
      setBooks(withProgress);
    } catch {
      setBooks([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function remove(id: string) {
    setBusyId(id);
    try {
      await deleteBook(id);
      setConfirmId(null);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (books === null) {
    return <p className="text-sm text-muted px-1">Loading your library…</p>;
  }
  if (books.length === 0) return null;

  const continueBook = books.find((b) => b.progressPct > 0 && b.progressPct < 99);

  return (
    <div className="space-y-8">
      {continueBook && !manage && <ContinueRow book={continueBook} />}

      <section>
        <div className="flex items-end justify-between mb-3">
          <h2 className="text-xl font-bold tracking-tight">Your library</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">
              {books.length} {books.length === 1 ? "book" : "books"}
            </span>
            <button
              onClick={() => {
                setManage((m) => !m);
                setConfirmId(null);
              }}
              className={
                "text-xs px-2 py-1 rounded-md transition " +
                (manage ? "bg-accent text-black" : "text-muted hover:text-text hover:bg-cardHover")
              }
            >
              {manage ? "Done" : "Manage"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-6">
          {books.map((b) => (
            <BookCard
              key={b.id}
              book={b}
              manage={manage}
              confirming={confirmId === b.id}
              busy={busyId === b.id}
              onAskDelete={() => setConfirmId(b.id)}
              onCancelDelete={() => setConfirmId(null)}
              onConfirmDelete={() => void remove(b.id)}
            />
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
            chapter {book.chapterIdx + 1} of {book.chapterCount} ·{" "}
            {book.progressPct.toFixed(0)}%
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

function BookCard({
  book,
  manage,
  confirming,
  busy,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete
}: {
  book: BookWithProgress;
  manage: boolean;
  confirming: boolean;
  busy: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const cover = (
    <div className="relative">
      <CoverArt
        title={book.title}
        size="md"
        className="!h-auto !w-full aspect-square !rounded-lg"
      />
      {book.progressPct > 0 && (
        <div className="absolute bottom-0 inset-x-0 h-1 bg-black/40">
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, book.progressPct)}%` }} />
        </div>
      )}
      {manage && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAskDelete();
          }}
          aria-label={`Delete ${book.title}`}
          className="absolute top-1.5 right-1.5 h-8 w-8 rounded-full grid place-items-center bg-black/70 text-red-300 hover:bg-red-500/80 hover:text-white transition"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
          </svg>
        </button>
      )}
    </div>
  );

  const meta = (
    <>
      <p className="mt-2 text-sm font-semibold truncate">{book.title}</p>
      <p className="text-[11px] text-muted">
        {book.chapterCount} chapters · {book.pageCount} pages
      </p>
    </>
  );

  if (confirming) {
    return (
      <div className="rounded-xl p-2 -m-2 bg-red-500/10 border border-red-500/30">
        {cover}
        <p className="mt-2 text-xs font-medium text-red-200 line-clamp-2">
          Delete &ldquo;{book.title}&rdquo;?
        </p>
        <p className="text-[10px] text-red-300/80 mt-0.5">
          Removes the text and your place. Cannot be undone.
        </p>
        <div className="flex gap-2 mt-2">
          <button
            onClick={onConfirmDelete}
            disabled={busy}
            className="text-xs px-2 py-1 rounded-md bg-red-500/30 text-red-100 hover:bg-red-500/50 disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            onClick={onCancelDelete}
            className="text-xs px-2 py-1 rounded-md text-muted hover:text-text"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (manage) {
    return (
      <div className="rounded-xl p-2 -m-2">
        {cover}
        {meta}
      </div>
    );
  }

  return (
    <Link href={`/reader/${book.id}`} className="group block rounded-xl p-2 -m-2 hover:bg-cardHover transition">
      {cover}
      {meta}
    </Link>
  );
}

/** Chapter ids are minted as ch_1, ch_2, … by lib/pdf/sectioning. */
function chapterIndexFromId(chapterId: string): number {
  const n = Number.parseInt(chapterId.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n - 1 : 0;
}

function estimatePct(book: BookRow, chapterIdx: number): number {
  if (book.chapterCount <= 0) return 0;
  return Math.max(0, Math.min(100, (chapterIdx / book.chapterCount) * 100));
}
