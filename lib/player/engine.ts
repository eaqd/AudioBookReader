/**
 * Audiobook player engine.
 *
 * Plays a flat stream of sentences as separate audio chunks, fetched from
 * IndexedDB or generated on demand via Kokoro. Maintains a small lookahead
 * (default 4) so generation runs while playback is happening, giving the
 * impression of gapless continuous reading.
 *
 * Public surface is small and event-driven; callers (Reader UI) subscribe
 * to state changes rather than polling.
 */

import { getAudio } from "@/lib/storage/audio";
import { synthesize, type SynthProgress } from "@/lib/tts/kokoro";
import { floatTo16BitWavBlob } from "@/lib/audio/wav";

export interface SentenceRef {
  /** Global index in the book (0..total-1). */
  globalIdx: number;
  chapterId: string;
  chapterIdx: number;
  /** Index of this sentence within the chapter. */
  sentenceIdx: number;
  text: string;
}

export interface EngineState {
  current: SentenceRef | null;
  playing: boolean;
  rate: number;
  /** Current sentence playback position in seconds. */
  positionSec: number;
  /** Current sentence duration in seconds (0 if unknown). */
  durationSec: number;
  /** True while a sentence is being synthesized in foreground. */
  generating: boolean;
  /** Sub-chunk progress when the foreground synth is running. */
  synthProgress: SynthProgress | null;
  /** Surfaced when synth fails (timeout, model error, etc). */
  lastError: string | null;
}

export type EngineListener = (s: EngineState) => void;

export interface EngineConfig {
  bookId: string;
  voice: string;
  /** How many sentences to keep prepared ahead of the current one. */
  lookahead?: number;
}

export class PlayerEngine {
  private cfg: Required<EngineConfig>;
  private sentences: SentenceRef[] = [];
  private currentIdx = 0;
  private rate = 1.0;
  private listeners = new Set<EngineListener>();

  /** Two audio elements for tight chunk transitions. */
  private a: HTMLAudioElement;
  private b: HTMLAudioElement;
  private active: HTMLAudioElement;
  private preload: HTMLAudioElement;
  private preloadedFor: number | null = null;
  private blobUrls = new Map<number, string>();

  private rafId: number | null = null;
  private generating = new Set<number>();
  private foregroundSynth: { idx: number; progress: SynthProgress | null } | null = null;
  private lastError: string | null = null;
  private unlocked = false;
  private silentUrl: string | null = null;

  constructor(config: EngineConfig) {
    this.cfg = {
      bookId: config.bookId,
      voice: config.voice,
      lookahead: config.lookahead ?? 4
    };
    if (typeof window === "undefined") {
      throw new Error("PlayerEngine must be constructed in the browser.");
    }
    this.a = new Audio();
    this.b = new Audio();
    [this.a, this.b].forEach((el) => {
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      // iOS: play inline; cast because TS lib still scopes this to HTMLVideoElement
      (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    });
    this.active = this.a;
    this.preload = this.b;
    this.bindEnded(this.a);
    this.bindEnded(this.b);
  }

  /* ------------------------- public API ------------------------- */

  setSentences(sentences: SentenceRef[]) {
    this.sentences = sentences;
  }

  setVoice(voice: string) {
    this.cfg.voice = voice;
  }

  setRate(rate: number) {
    this.rate = rate;
    this.a.playbackRate = rate;
    this.b.playbackRate = rate;
    this.emit();
  }

  getRate(): number {
    return this.rate;
  }

  isPlaying(): boolean {
    return !this.active.paused && !this.active.ended;
  }

  state(): EngineState {
    return {
      current: this.sentences[this.currentIdx] ?? null,
      playing: this.isPlaying(),
      rate: this.rate,
      positionSec: this.active.currentTime || 0,
      durationSec: Number.isFinite(this.active.duration) ? this.active.duration : 0,
      generating: this.generating.size > 0,
      synthProgress: this.foregroundSynth?.progress ?? null,
      lastError: this.lastError
    };
  }

  clearError() {
    this.lastError = null;
    this.emit();
  }

  /**
   * iOS Safari blocks .play() unless it was initiated synchronously inside
   * a user gesture. After awaiting model load + synthesis, the gesture has
   * long expired. Workaround: as soon as the user taps Play (or a sentence),
   * call this *synchronously* — it kicks both audio elements with a tiny
   * silent WAV so they enter the "user-interacted" state and remain
   * playable for the rest of the session, even after long awaits.
   *
   * Safe to call repeatedly; only the first call has any effect.
   */
  prime(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    if (!this.silentUrl) {
      // 50ms of silence at 8kHz mono 16-bit. Browser can decode, iOS happy.
      const samples = new Float32Array(400);
      const blob = floatTo16BitWavBlob(samples, 8000);
      this.silentUrl = URL.createObjectURL(blob);
    }
    for (const el of [this.a, this.b]) {
      try {
        el.src = this.silentUrl;
        el.load();
        const p = el.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {
        /* fall through; we'll get a NotAllowedError later if needed */
      }
    }
  }

  subscribe(fn: EngineListener): () => void {
    this.listeners.add(fn);
    fn(this.state());
    return () => this.listeners.delete(fn);
  }

  /**
   * Set the current sentence index. When `autoplay` is true (or when audio
   * for this sentence is already cached) this also materializes the audio
   * and starts playback. Otherwise it only updates state — no model load,
   * no synthesis — so callers can position the reader on mount without
   * triggering a speech-model fetch before the user has pressed Play.
   */
  async seekToSentence(globalIdx: number, autoplay = true): Promise<void> {
    const ref = this.sentences[globalIdx];
    if (!ref) return;
    this.currentIdx = globalIdx;
    this.preloadedFor = null;

    if (!autoplay) {
      // Lightweight position update only.
      this.active.pause();
      this.emit();
      return;
    }

    const url = await this.ensureUrl(globalIdx);
    this.swapTo(this.active, url);
    this.active.playbackRate = this.rate;
    this.active.currentTime = 0;
    await this.waitMetadata(this.active);
    this.emit();
    void this.preloadAhead();
    await this.play();
  }

  /** Seek within the current sentence (in seconds). */
  seekWithinSentence(sec: number) {
    const dur = Number.isFinite(this.active.duration) ? this.active.duration : 0;
    this.active.currentTime = Math.max(0, Math.min(sec, dur));
    this.emit();
  }

  async play(): Promise<void> {
    try {
      // First press after a positional seek: materialize audio for the
      // current sentence now, then play it.
      if (!this.active.src) {
        const url = await this.ensureUrl(this.currentIdx);
        this.swapTo(this.active, url);
        this.active.playbackRate = this.rate;
        await this.waitMetadata(this.active);
      }
      await this.active.play();
      this.startTicker();
      void this.preloadAhead();
      this.emit();
    } catch (e) {
      this.emit();
      throw e;
    }
  }

  pause() {
    this.active.pause();
    this.stopTicker();
    this.emit();
  }

  /** Skip by `delta` seconds, crossing chunk boundaries when needed. */
  async skipBySeconds(delta: number): Promise<void> {
    const target = this.active.currentTime + delta;
    if (target < 0) {
      // hop into the previous sentence's tail
      const prevIdx = this.currentIdx - 1;
      if (prevIdx < 0) {
        this.active.currentTime = 0;
        this.emit();
        return;
      }
      const prevDur = await this.ensureDuration(prevIdx);
      const into = Math.max(0, prevDur + target);
      await this.seekToSentence(prevIdx, this.isPlaying());
      this.active.currentTime = into;
      this.emit();
      return;
    }
    const dur = Number.isFinite(this.active.duration) ? this.active.duration : 0;
    if (target > dur) {
      let overshoot = target - dur;
      let idx = this.currentIdx + 1;
      while (idx < this.sentences.length) {
        const d = await this.ensureDuration(idx);
        if (overshoot <= d) {
          await this.seekToSentence(idx, this.isPlaying());
          this.active.currentTime = overshoot;
          this.emit();
          return;
        }
        overshoot -= d;
        idx += 1;
      }
      // ran past the end
      await this.seekToSentence(this.sentences.length - 1, false);
      this.active.currentTime = this.active.duration || 0;
      this.pause();
      return;
    }
    this.active.currentTime = target;
    this.emit();
  }

  prevSentence() {
    if (this.currentIdx > 0) void this.seekToSentence(this.currentIdx - 1, this.isPlaying());
    else this.active.currentTime = 0;
  }

  nextSentence() {
    if (this.currentIdx < this.sentences.length - 1) {
      void this.seekToSentence(this.currentIdx + 1, this.isPlaying());
    } else {
      this.pause();
    }
  }

  prevChapter() {
    const cur = this.sentences[this.currentIdx];
    if (!cur) return;
    // start of current chapter, or previous chapter if already at the start
    const sameStart = this.sentences.findIndex((s) => s.chapterId === cur.chapterId);
    if (this.currentIdx > sameStart) {
      void this.seekToSentence(sameStart, this.isPlaying());
      return;
    }
    // jump to chapter (chapterIdx - 1)
    const target = this.sentences.find((s) => s.chapterIdx === cur.chapterIdx - 1);
    if (target) void this.seekToSentence(target.globalIdx, this.isPlaying());
  }

  nextChapter() {
    const cur = this.sentences[this.currentIdx];
    if (!cur) return;
    const target = this.sentences.find((s) => s.chapterIdx === cur.chapterIdx + 1);
    if (target) void this.seekToSentence(target.globalIdx, this.isPlaying());
    else this.pause();
  }

  destroy() {
    this.stopTicker();
    [this.a, this.b].forEach((el) => {
      el.pause();
      el.src = "";
      el.load();
    });
    for (const url of this.blobUrls.values()) URL.revokeObjectURL(url);
    this.blobUrls.clear();
    if (this.silentUrl) {
      URL.revokeObjectURL(this.silentUrl);
      this.silentUrl = null;
    }
    this.listeners.clear();
  }

  /* ------------------------- internals ------------------------- */

  private bindEnded(el: HTMLAudioElement) {
    el.addEventListener("ended", () => {
      if (el !== this.active) return;
      const nextIdx = this.currentIdx + 1;
      if (nextIdx >= this.sentences.length) {
        this.pause();
        return;
      }
      // Use the preloaded element if we already have the next chunk loaded.
      if (this.preloadedFor === nextIdx) {
        const swap = this.preload;
        this.preload = this.active;
        this.active = swap;
        this.currentIdx = nextIdx;
        this.preloadedFor = null;
        this.active.playbackRate = this.rate;
        this.active.currentTime = 0;
        void this.active.play().then(() => this.startTicker()).catch(() => {});
        this.emit();
        void this.preloadAhead();
      } else {
        void this.seekToSentence(nextIdx, true);
      }
    });
    el.addEventListener("error", () => {
      if (el === this.active) this.emit();
    });
  }

  private swapTo(el: HTMLAudioElement, url: string) {
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

  private async ensureUrl(idx: number): Promise<string> {
    const cached = this.blobUrls.get(idx);
    if (cached) return cached;
    const ref = this.sentences[idx];
    if (!ref) throw new Error(`No sentence at index ${idx}`);
    const row =
      (await getAudio(this.cfg.bookId, ref.chapterId, ref.sentenceIdx)) ??
      (await this.generateAndCache(ref));
    const url = URL.createObjectURL(row.blob);
    this.blobUrls.set(idx, url);
    this.maybeEvictUrls();
    return url;
  }

  private async ensureDuration(idx: number): Promise<number> {
    const ref = this.sentences[idx];
    if (!ref) return 0;
    const existing = await getAudio(this.cfg.bookId, ref.chapterId, ref.sentenceIdx);
    if (existing) return existing.duration;
    // Heuristic: 14 chars/sec at 1x for English speech.
    return Math.max(1, ref.text.length / 14);
  }

  private async generateAndCache(ref: SentenceRef) {
    if (this.generating.has(ref.globalIdx)) {
      while (this.generating.has(ref.globalIdx)) {
        await sleep(50);
      }
      const existing = await getAudio(this.cfg.bookId, ref.chapterId, ref.sentenceIdx);
      if (existing) return existing;
    }
    this.generating.add(ref.globalIdx);
    const isForeground = ref.globalIdx === this.currentIdx;
    if (isForeground) this.foregroundSynth = { idx: ref.globalIdx, progress: null };
    this.emit();
    try {
      const row = await synthesize(
        this.cfg.bookId,
        ref.chapterId,
        ref.sentenceIdx,
        ref.text,
        this.cfg.voice,
        {
          onProgress: (p) => {
            if (isForeground) {
              this.foregroundSynth = { idx: ref.globalIdx, progress: p };
              this.emit();
            }
          }
        }
      );
      this.lastError = null;
      return row;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.lastError = msg;
      throw e;
    } finally {
      this.generating.delete(ref.globalIdx);
      if (isForeground) this.foregroundSynth = null;
      this.emit();
    }
  }

  private async preloadAhead() {
    // Always preload the next sentence into the inactive element if not yet.
    const nextIdx = this.currentIdx + 1;
    if (nextIdx < this.sentences.length && this.preloadedFor !== nextIdx) {
      try {
        const url = await this.ensureUrl(nextIdx);
        this.swapTo(this.preload, url);
        this.preload.playbackRate = this.rate;
        this.preloadedFor = nextIdx;
      } catch {
        /* preload failure isn't fatal */
      }
    }
    // Then warm up further sentences in the background.
    const horizon = this.currentIdx + this.cfg.lookahead;
    for (let i = this.currentIdx + 2; i <= horizon && i < this.sentences.length; i++) {
      const ref = this.sentences[i];
      const cached = await getAudio(this.cfg.bookId, ref.chapterId, ref.sentenceIdx);
      if (!cached) {
        scheduleIdle(() => {
          void this.generateAndCache(ref);
        });
      }
    }
  }

  private maybeEvictUrls() {
    // Keep a small ring around the current sentence to bound memory.
    const ringHalf = Math.max(this.cfg.lookahead, 2);
    const lo = this.currentIdx - 2;
    const hi = this.currentIdx + ringHalf;
    for (const [idx, url] of this.blobUrls) {
      if (idx < lo || idx > hi) {
        URL.revokeObjectURL(url);
        this.blobUrls.delete(idx);
      }
    }
  }

  private startTicker() {
    if (this.rafId != null) return;
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      this.emit();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTicker() {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private emit() {
    const s = this.state();
    for (const fn of this.listeners) fn(s);
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function scheduleIdle(fn: () => void) {
  type IdleCB = (cb: () => void, opts?: { timeout?: number }) => number;
  const w = window as unknown as { requestIdleCallback?: IdleCB };
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(fn, { timeout: 5000 });
  } else {
    setTimeout(fn, 0);
  }
}
