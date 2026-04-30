import {
  audioId,
  getDB,
  type BookContentRow,
  type BookRow,
  type ChapterPayload
} from "./db";
import type { BookContent } from "@/lib/pdf/sectioning";

export interface AddBookInput {
  title: string;
  fileName: string;
  voice: string;
  pageCount: number;
  detectionMode: BookContent["detectionMode"];
  chapters: ChapterPayload[];
  pdfBlob: Blob;
}

export async function addBook(input: AddBookInput): Promise<BookRow> {
  const db = await getDB();
  const id = makeBookId();
  const sentenceCount = input.chapters.reduce((s, c) => s + c.sentences.length, 0);
  const row: BookRow = {
    id,
    title: input.title,
    fileName: input.fileName,
    pageCount: input.pageCount,
    chapterCount: input.chapters.length,
    sentenceCount,
    voice: input.voice,
    detectionMode: input.detectionMode,
    addedAt: Date.now()
  };
  const content: BookContentRow = { bookId: id, chapters: input.chapters };
  const tx = db.transaction(["books", "bookContent", "pdfBlobs"], "readwrite");
  await Promise.all([
    tx.objectStore("books").put(row),
    tx.objectStore("bookContent").put(content),
    tx.objectStore("pdfBlobs").put({ bookId: id, blob: input.pdfBlob })
  ]);
  await tx.done;
  return row;
}

export async function listBooks(): Promise<BookRow[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("books", "addedAt");
  // newest first
  return all.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getBook(id: string): Promise<BookRow | null> {
  const db = await getDB();
  return (await db.get("books", id)) ?? null;
}

export async function getBookContent(bookId: string): Promise<BookContentRow | null> {
  const db = await getDB();
  return (await db.get("bookContent", bookId)) ?? null;
}

export async function updateBookVoice(bookId: string, voice: string): Promise<void> {
  const db = await getDB();
  const row = await db.get("books", bookId);
  if (!row) return;
  row.voice = voice;
  await db.put("books", row);
}

export async function deleteBook(bookId: string): Promise<void> {
  const db = await getDB();
  // delete cascades: book row, content, progress, pdf, all audio chunks
  const tx = db.transaction(
    ["books", "bookContent", "progress", "pdfBlobs", "audio"],
    "readwrite"
  );
  await Promise.all([
    tx.objectStore("books").delete(bookId),
    tx.objectStore("bookContent").delete(bookId),
    tx.objectStore("progress").delete(bookId),
    tx.objectStore("pdfBlobs").delete(bookId)
  ]);
  // Delete audio chunks for this book using the bookId index.
  const audioStore = tx.objectStore("audio");
  const idx = audioStore.index("bookId");
  let cursor = await idx.openCursor(IDBKeyRange.only(bookId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

function makeBookId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `bk_${crypto.randomUUID().slice(0, 12).replace(/-/g, "")}`;
  }
  return `bk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export { audioId };
