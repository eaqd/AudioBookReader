/**
 * Gapless audio player for chunked MP3s.
 *
 * Maintains two HTMLAudioElement slots (active + preload). When playback of
 * the active slot nears its end, we preload the next chunk into the
 * inactive slot so swap-on-`ended` is instant.
 *
 * Word highlighting state: we publish the active word index by binary
 * searching `currentTime` against the loaded chunk's `words[]` array.
 */

import type { ChunkOut } from "../types";
import { api } from "./api";

export interface PlayerCallbacks {
  /** Fires whenever the current chunk changes (after fetching new data). */
  onChunkChange: (chunk: ChunkOut, indexInBook: number) => void;
  /** Fires ~250ms while playing with current word index in active chunk. */
  onWordTick: (chunkId: string, wordIdx: number, timeSec: number) => void;
  /** Play/pause state updates (UI + media session). */
  onPlayState: (playing: boolean) => void;
  /** Reached the end of the entire book. */
  onBookEnd: () => void;
  /** Errors (network, decode, etc). */
  onError: (msg: string) => void;
}

export interface ChunkRef {
  id: string;
  idx: number;
}

export class AudioBookPlayer {
  private bookId = "";
  private chunkOrder: ChunkRef[] = [];
  private chunkCache = new Map<string, ChunkOut>();
  private currentIdx = 0;       // index into chunkOrder
  private currentWord = -1;
  private rate = 1.0;

  private a: HTMLAudioElement;
  private b: HTMLAudioElement;
  private active: HTMLAudioElement;
  private preload: HTMLAudioElement;
  private preloadedFor: string | null = null;

  private rafId: number | null = null;

  constructor(private cb: PlayerCallbacks) {
    this.a = new Audio();
    this.b = new Audio();
    [this.a, this.b].forEach((el) => {
      el.preload = "auto";
      el.crossOrigin = "anonymous";
    });
    this.active = this.a;
    this.preload = this.b;

    this.bindEnded(this.a);
    this.bindEnded(this.b);
  }

  destroy(): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.a.pause();
    this.b.pause();
    this.a.src = "";
    this.b.src = "";
  }

  setBook(bookId: string, order: ChunkRef[]): void {
    this.bookId = bookId;
    this.chunkOrder = order;
    this.chunkCache.clear();
    this.currentIdx = 0;
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.a.playbackRate = rate;
    this.b.playbackRate = rate;
  }

  getActiveChunk(): ChunkOut | undefined {
    const ref = this.chunkOrder[this.currentIdx];
    return ref ? this.chunkCache.get(ref.id) : undefined;
  }

  isPlaying(): boolean {
    return !this.active.paused && !this.active.ended;
  }

  currentTimeSec(): number {
    return this.active.currentTime;
  }

  currentChunkDurationSec(): number {
    const ck = this.getActiveChunk();
    return ck ? ck.duration_ms / 1000 : 0;
  }

  /** Jump to a specific chunk + offset (seconds within chunk). */
  async seekToChunk(chunkId: string, offsetSec: number, autoplay = true): Promise<void> {
    const idx = this.chunkOrder.findIndex((c) => c.id === chunkId);
    if (idx < 0) {
      this.cb.onError(`unknown chunk ${chunkId}`);
      return;
    }
    this.currentIdx = idx;
    const chunk = await this.fetchChunk(chunkId);
    this.swapTo(this.active, chunk.audio_url);
    this.active.playbackRate = this.rate;
    await this.waitMetadata(this.active);
    this.active.currentTime = Math.max(0, Math.min(offsetSec, chunk.duration_ms / 1000));
    this.currentWord = -1;
    this.cb.onChunkChange(chunk, idx);
    this.preloadNext();
    if (autoplay) await this.play();
    else this.startTicker();
  }

  /** Jump to a word in the currently-loaded chunk. */
  async seekToWord(chunkId: string, wordIdx: number, autoplay = true): Promise<void> {
    const ck = await this.fetchChunk(chunkId);
    const w = ck.words[wordIdx];
    const t = w ? w.s : 0;
    await this.seekToChunk(chunkId, t, autoplay);
  }

  async play(): Promise<void> {
    try {
      await this.active.play();
      this.cb.onPlayState(true);
      this.startTicker();
    } catch (e) {
      this.cb.onError((e as Error).message);
    }
  }

  pause(): void {
    this.active.pause();
    this.cb.onPlayState(false);
    this.stopTicker();
  }

  seekRelative(deltaSec: number): void {
    const target = this.active.currentTime + deltaSec;
    if (target < 0) {
      // jump to previous chunk
      const prevRef = this.chunkOrder[this.currentIdx - 1];
      if (prevRef) {
        void this.seekToChunk(prevRef.id, Math.max(0, this.chunkCache.get(prevRef.id)?.duration_ms
          ? this.chunkCache.get(prevRef.id)!.duration_ms / 1000 + target
          : 0));
        return;
      }
      this.active.currentTime = 0;
      return;
    }
    const dur = this.currentChunkDurationSec();
    if (target > dur) {
      const overflow = target - dur;
      const nextRef = this.chunkOrder[this.currentIdx + 1];
      if (nextRef) {
        void this.seekToChunk(nextRef.id, overflow);
        return;
      }
      this.active.currentTime = dur;
      return;
    }
    this.active.currentTime = target;
  }

  // --- internals -------------------------------------------------------

  private bindEnded(el: HTMLAudioElement): void {
    el.addEventListener("ended", () => {
      if (el !== this.active) return;
      const nextRef = this.chunkOrder[this.currentIdx + 1];
      if (!nextRef) {
        this.cb.onPlayState(false);
        this.cb.onBookEnd();
        return;
      }
      // Prefer the preloaded element if it has the right chunk.
      const expectedUrl = this.chunkCache.get(nextRef.id)?.audio_url;
      if (expectedUrl && this.preloadedFor === nextRef.id) {
        const swap = this.preload;
        this.preload = this.active;
        this.active = swap;
        this.currentIdx += 1;
        this.preloadedFor = null;
        this.active.playbackRate = this.rate;
        this.active.currentTime = 0;
        this.currentWord = -1;
        const ck = this.chunkCache.get(nextRef.id);
        if (ck) this.cb.onChunkChange(ck, this.currentIdx);
        void this.active.play().then(() => this.startTicker());
        this.preloadNext();
      } else {
        // No preload available — load + play.
        void this.seekToChunk(nextRef.id, 0, true);
      }
    });
    el.addEventListener("error", () => {
      if (el === this.active) {
        this.cb.onError("audio decode/network error");
      }
    });
  }

  private swapTo(el: HTMLAudioElement, audioPath: string): void {
    const url = api.audioUrl(audioPath);
    if (el.src !== url) {
      el.src = url;
      el.load();
    }
  }

  private waitMetadata(el: HTMLAudioElement): Promise<void> {
    if (el.readyState >= 1) return Promise.resolve();
    return new Promise((resolve) => {
      const fn = () => {
        el.removeEventListener("loadedmetadata", fn);
        resolve();
      };
      el.addEventListener("loadedmetadata", fn);
    });
  }

  private async fetchChunk(chunkId: string): Promise<ChunkOut> {
    const cached = this.chunkCache.get(chunkId);
    if (cached) return cached;
    const ck = await api.getChunk(this.bookId, chunkId);
    this.chunkCache.set(chunkId, ck);
    return ck;
  }

  private preloadNext(): void {
    const nextRef = this.chunkOrder[this.currentIdx + 1];
    if (!nextRef) return;
    if (this.preloadedFor === nextRef.id) return;
    void this.fetchChunk(nextRef.id).then((ck) => {
      this.swapTo(this.preload, ck.audio_url);
      this.preload.playbackRate = this.rate;
      this.preloadedFor = nextRef.id;
    });
  }

  private startTicker(): void {
    if (this.rafId != null) return;
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      const ck = this.getActiveChunk();
      if (!ck || !ck.words.length) return;
      const t = this.active.currentTime;
      const wIdx = findActiveWord(ck.words, t);
      if (wIdx !== this.currentWord) {
        this.currentWord = wIdx;
        this.cb.onWordTick(ck.id, wIdx, t);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTicker(): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}

/** Binary search for the word containing time `t` (seconds). */
export function findActiveWord(words: { s: number; e: number }[], t: number): number {
  if (!words.length) return -1;
  if (t <= words[0].s) return 0;
  if (t >= words[words.length - 1].e) return words.length - 1;
  let lo = 0;
  let hi = words.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = words[mid];
    if (t < w.s) hi = mid - 1;
    else if (t > w.e) lo = mid + 1;
    else return mid;
  }
  // between words: snap to the previous one
  return Math.max(0, hi);
}
