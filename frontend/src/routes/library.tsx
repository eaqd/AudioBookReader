import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { api } from "../lib/api";
import type { BookSummary } from "../types";

export function LibraryPage(): JSX.Element {
  const [books, setBooks] = useState<BookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const list = await api.listBooks();
      setBooks(list);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col h-screen">
      <header className="px-5 pt-6 pb-3 safe-top flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Library</h1>
        <div className="flex gap-2">
          <Link
            to="/settings"
            className="text-sm px-3 py-1.5 rounded-full border border-current/20"
          >
            Settings
          </Link>
          <Link
            to="/upload"
            className="text-sm px-3 py-1.5 rounded-full bg-indigo-600 text-white"
          >
            + Upload
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-4 pb-10">
        {error && <p className="text-red-500 text-sm">{error}</p>}
        {books == null ? (
          <p className="opacity-60 px-2 mt-4">Loading…</p>
        ) : books.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mt-2">
            {books.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="mt-16 mx-auto max-w-md text-center opacity-80">
      <h2 className="text-xl font-medium mb-2">No books yet</h2>
      <p className="text-sm mb-4">
        Upload a PDF to turn it into a synchronized audiobook with natural
        narration and click-to-seek text.
      </p>
      <Link
        to="/upload"
        className="inline-block text-sm px-4 py-2 rounded-full bg-indigo-600 text-white"
      >
        Upload your first book
      </Link>
    </div>
  );
}

function BookCard({ book }: { book: BookSummary }): JSX.Element {
  const inner = (
    <div className="block aspect-[2/3] rounded-xl overflow-hidden border border-current/10 bg-current/5 relative">
      {book.cover_url ? (
        <img src={book.cover_url} className="w-full h-full object-cover" alt="" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs px-3 text-center opacity-70">
          {book.title}
        </div>
      )}
      {book.status !== "ready" && (
        <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-white">
          {book.status}
        </span>
      )}
    </div>
  );
  if (book.status === "ready") {
    return (
      <Link
        to="/book/$bookId"
        params={{ bookId: book.id }}
        className="block"
      >
        {inner}
        <p className="mt-1 text-sm font-medium line-clamp-2">{book.title}</p>
        {book.author && (
          <p className="text-xs opacity-60 line-clamp-1">{book.author}</p>
        )}
      </Link>
    );
  }
  return (
    <div className="block opacity-70 cursor-default">
      {inner}
      <p className="mt-1 text-sm font-medium line-clamp-2">{book.title}</p>
      <p className="text-xs opacity-60">processing…</p>
    </div>
  );
}
