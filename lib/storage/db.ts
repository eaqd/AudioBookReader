/**
 * IndexedDB schema for the audiobook reader.
 *
 * Stores:
 *   books         keyPath: id        — one row per book
 *   bookContent   keyPath: bookId    — chapter/sentence text payload
 *   audio         keyPath: id        — generated TTS audio per sentence
 *                 indexed: bookId
 *   progress      keyPath: bookId    — last position per book
 *   pdfBlobs      keyPath: bookId    — original PDF (for re-extract or share)
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface BookRow {
  id: string;
  title: string;
  fileName: string;
  pageCount: number;
  chapterCount: number;
  sentenceCount: number;
  voice: string;
  detectionMode: "outline" | "heading" | "wordSplit";
  /** ms (Date.now). */
  addedAt: number;
}

export interface ChapterPayload {
  id: string;
  title: string;
  startPage: number;
  sentences: string[];
}

export interface BookContentRow {
  bookId: string;
  chapters: ChapterPayload[];
}

export interface AudioChunkRow {
  /** `${bookId}::${chapterId}::${sentenceIdx}` */
  id: string;
  bookId: string;
  chapterId: string;
  sentenceIdx: number;
  voice: string;
  /** seconds. */
  duration: number;
  /** Raw WAV audio. */
  blob: Blob;
}

export interface ProgressRow {
  bookId: string;
  chapterId: string;
  sentenceIdx: number;
  /** Offset within the active sentence (seconds). */
  offsetSec: number;
  updatedAt: number;
}

export interface PdfBlobRow {
  bookId: string;
  blob: Blob;
}

interface ABRSchema extends DBSchema {
  books: {
    key: string;
    value: BookRow;
    indexes: { addedAt: number };
  };
  bookContent: {
    key: string;
    value: BookContentRow;
  };
  audio: {
    key: string;
    value: AudioChunkRow;
    indexes: { bookId: string };
  };
  progress: {
    key: string;
    value: ProgressRow;
  };
  pdfBlobs: {
    key: string;
    value: PdfBlobRow;
  };
}

let _db: Promise<IDBPDatabase<ABRSchema>> | null = null;

export function getDB(): Promise<IDBPDatabase<ABRSchema>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable in this environment."));
  }
  if (!_db) {
    _db = openDB<ABRSchema>("audiobookreader", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("books")) {
          const s = db.createObjectStore("books", { keyPath: "id" });
          s.createIndex("addedAt", "addedAt");
        }
        if (!db.objectStoreNames.contains("bookContent")) {
          db.createObjectStore("bookContent", { keyPath: "bookId" });
        }
        if (!db.objectStoreNames.contains("audio")) {
          const s = db.createObjectStore("audio", { keyPath: "id" });
          s.createIndex("bookId", "bookId");
        }
        if (!db.objectStoreNames.contains("progress")) {
          db.createObjectStore("progress", { keyPath: "bookId" });
        }
        if (!db.objectStoreNames.contains("pdfBlobs")) {
          db.createObjectStore("pdfBlobs", { keyPath: "bookId" });
        }
      }
    });
  }
  return _db;
}

export function audioId(bookId: string, chapterId: string, sentenceIdx: number): string {
  return `${bookId}::${chapterId}::${sentenceIdx}`;
}
