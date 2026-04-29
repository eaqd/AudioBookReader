import { create } from "zustand";
import type { BookDetail, ChunkOut } from "../types";

interface ReaderState {
  book: BookDetail | null;
  chunk: ChunkOut | null;
  currentIdxInBook: number;       // global chunk index
  activeWordIdx: number;
  playing: boolean;
  rate: number;
  followMode: boolean;
  totalElapsedMs: number;          // computed
  totalDurationMs: number;
  setBook: (b: BookDetail) => void;
  setChunk: (c: ChunkOut, idx: number) => void;
  setWord: (i: number) => void;
  setPlaying: (p: boolean) => void;
  setRate: (r: number) => void;
  setFollow: (f: boolean) => void;
  setElapsed: (ms: number) => void;
}

export const useReader = create<ReaderState>((set) => ({
  book: null,
  chunk: null,
  currentIdxInBook: 0,
  activeWordIdx: -1,
  playing: false,
  rate: 1.0,
  followMode: true,
  totalElapsedMs: 0,
  totalDurationMs: 0,
  setBook: (b) => set({ book: b, totalDurationMs: b.total_duration_ms }),
  setChunk: (c, idx) => set({ chunk: c, currentIdxInBook: idx, activeWordIdx: -1 }),
  setWord: (i) => set({ activeWordIdx: i }),
  setPlaying: (p) => set({ playing: p }),
  setRate: (r) => set({ rate: r }),
  setFollow: (f) => set({ followMode: f }),
  setElapsed: (ms) => set({ totalElapsedMs: ms })
}));

/** Cumulative ms before chunk at `idx`, given a flat chunk index list. */
export function cumulativeMsBefore(
  chunks: { idx: number; duration_ms: number }[],
  globalIdx: number
): number {
  let total = 0;
  for (const c of chunks) {
    if (c.idx >= globalIdx) break;
    total += c.duration_ms;
  }
  return total;
}
