/**
 * Audiobook player engine backed by the device speech synthesiser.
 *
 * The previous implementation generated audio with Kokoro and played it
 * through HTMLAudioElement. Measured in-browser, Kokoro ran 4.6x slower
 * than realtime, so playback could never keep up with generation. Device
 * voices speak immediately, which removes the audio cache, the lookahead
 * queue and the 80MB model download entirely.
 *
 * The Web Speech API has no seekable timeline, so position and duration
 * are estimated from how far through the sentence text the engine has
 * reported, and seeking restarts the sentence from a character offset.
 */

import {
  listVoices,
  pickDefaultVoice,
  primeSpeech,
  speak,
  speechSupported,
  startKeepAlive,
  type SpeakHandle
} from "@/lib/tts/speech";

export interface SentenceRef {
  globalIdx: number;
  chapterId: string;
  chapterIdx: number;
  sentenceIdx: number;
  text: string;
}

export interface EngineState {
  current: SentenceRef | null;
  playing: boolean;
  rate: number;
  /** Estimated position within the current sentence, in seconds. */
  positionSec: number;
  /** Estimated duration of the current sentence, in seconds. */
  durationSec: number;
  /** Retained for API compatibility; device speech never generates. */
  generating: boolean;
  synthProgress: null;
  lastError: string | null;
  /** Character offset reached in the current sentence. */
  charIndex: number;
  /** Index of the word currently being spoken, or -1. */
  wordIdx: number;
}

export type EngineListener = (s: EngineState) => void;

export interface EngineConfig {
  bookId: string;
  voice: string | null;
}

/** Average characters spoken per second at rate 1.0. */
const CHARS_PER_SEC = 14;

export class PlayerEngine {
  private sentences: SentenceRef[] = [];
  private currentIdx = 0;
  private rate = 1.0;
  private voiceId: string | null;
  private listeners = new Set<EngineListener>();

  private handle: SpeakHandle | null = null;
  private playing = false;
  private charIndex = 0;
  private baseChar = 0;
  private lastError: string | null = null;
  private stopKeepAlive: (() => void) | null = null;
  private tickId: number | null = null;
  private startedAt = 0;

  constructor(config: EngineConfig) {
    if (typeof window === "undefined") {
      throw new Error("PlayerEngine must be constructed in the browser.");
    }
    this.voiceId = config.voice;
    void this.ensureVoice();
  }

  private async ensureVoice() {
    if (this.voiceId) return;
    const voices = await listVoices();
    this.voiceId = pickDefaultVoice(voices);
    this.emit();
  }

  setSentences(sentences: SentenceRef[]) {
    this.sentences = sentences;
  }

  setVoice(voice: string | null) {
    this.voiceId = voice;
    if (this.playing) {
      const resumeAt = this.charIndex;
      this.stopSpeaking();
      this.speakCurrent(resumeAt);
    }
    this.emit();
  }

  getVoice(): string | null {
    return this.voiceId;
  }

  setRate(rate: number) {
    this.rate = rate;
    if (this.playing) {
      const resumeAt = this.charIndex;
      this.stopSpeaking();
      this.speakCurrent(resumeAt);
    }
    this.emit();
  }

  getRate(): number {
    return this.rate;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  state(): EngineState {
    const cur = this.sentences[this.currentIdx] ?? null;
    const len = cur?.text.length ?? 0;
    const perSec = CHARS_PER_SEC * this.rate;
    return {
      current: cur,
      playing: this.playing,
      rate: this.rate,
      positionSec: perSec > 0 ? this.charIndex / perSec : 0,
      durationSec: perSec > 0 ? len / perSec : 0,
      generating: false,
      synthProgress: null,
      lastError: this.lastError,
      charIndex: this.charIndex,
      wordIdx: cur ? wordIndexAtChar(cur.text, this.charIndex) : -1
    };
  }

  subscribe(fn: EngineListener): () => void {
    this.listeners.add(fn);
    fn(this.state());
    return () => this.listeners.delete(fn);
  }

  clearError() {
    this.lastError = null;
    this.emit();
  }

  /** Must be called synchronously inside a user gesture (iOS unlock). */
  prime(): void {
    primeSpeech();
  }

  async seekToSentence(globalIdx: number, autoplay = true): Promise<void> {
    const ref = this.sentences[globalIdx];
    if (!ref) return;
    this.stopSpeaking();
    this.currentIdx = globalIdx;
    this.charIndex = 0;
    this.baseChar = 0;
    if (autoplay) this.speakCurrent(0);
    this.emit();
  }

  seekWithinSentence(sec: number) {
    const cur = this.sentences[this.currentIdx];
    if (!cur) return;
    const perSec = CHARS_PER_SEC * this.rate;
    const target = Math.max(0, Math.min(cur.text.length, Math.round(sec * perSec)));
    this.charIndex = target;
    if (this.playing) {
      this.stopSpeaking();
      this.speakCurrent(target);
    }
    this.emit();
  }

  async play(): Promise<void> {
    if (!speechSupported()) {
      this.lastError = "This browser does not support speech synthesis.";
      this.emit();
      return;
    }
    if (this.playing) return;
    this.speakCurrent(this.charIndex);
    this.emit();
  }

  pause() {
    this.stopSpeaking();
    this.emit();
  }

  async skipBySeconds(delta: number): Promise<void> {
    const perSec = CHARS_PER_SEC * this.rate;
    let idx = this.currentIdx;
    let pos = this.charIndex + Math.round(delta * perSec);

    while (idx >= 0 && idx < this.sentences.length) {
      const len = this.sentences[idx].text.length;
      if (pos < 0) {
        idx -= 1;
        if (idx < 0) {
          idx = 0;
          pos = 0;
          break;
        }
        pos += this.sentences[idx].text.length;
      } else if (pos > len) {
        pos -= len;
        idx += 1;
        if (idx >= this.sentences.length) {
          idx = this.sentences.length - 1;
          pos = this.sentences[idx].text.length;
          break;
        }
      } else {
        break;
      }
    }
    const wasPlaying = this.playing;
    this.stopSpeaking();
    this.currentIdx = Math.max(0, Math.min(idx, this.sentences.length - 1));
    this.charIndex = Math.max(0, pos);
    if (wasPlaying) this.speakCurrent(this.charIndex);
    this.emit();
  }

  prevSentence() {
    void this.seekToSentence(Math.max(0, this.currentIdx - 1), this.playing);
  }

  nextSentence() {
    if (this.currentIdx < this.sentences.length - 1) {
      void this.seekToSentence(this.currentIdx + 1, this.playing);
    } else {
      this.pause();
    }
  }

  prevChapter() {
    const cur = this.sentences[this.currentIdx];
    if (!cur) return;
    const start = this.sentences.findIndex((s) => s.chapterId === cur.chapterId);
    if (this.currentIdx > start) {
      void this.seekToSentence(start, this.playing);
      return;
    }
    const target = this.sentences.find((s) => s.chapterIdx === cur.chapterIdx - 1);
    if (target) void this.seekToSentence(target.globalIdx, this.playing);
  }

  nextChapter() {
    const cur = this.sentences[this.currentIdx];
    if (!cur) return;
    const target = this.sentences.find((s) => s.chapterIdx === cur.chapterIdx + 1);
    if (target) void this.seekToSentence(target.globalIdx, this.playing);
    else this.pause();
  }

  destroy() {
    this.stopSpeaking();
    this.listeners.clear();
  }

  private speakCurrent(fromChar: number) {
    const cur = this.sentences[this.currentIdx];
    if (!cur) return;
    const text = cur.text.slice(fromChar);
    if (!text.trim()) {
      this.advance();
      return;
    }
    this.baseChar = fromChar;
    this.charIndex = fromChar;
    this.playing = true;
    this.startedAt = Date.now();
    this.stopKeepAlive?.();
    this.stopKeepAlive = startKeepAlive();
    this.startTicker();

    this.handle = speak(text, {
      voiceId: this.voiceId,
      rate: this.rate,
      onBoundary: (ci) => {
        this.charIndex = this.baseChar + ci;
        this.emit();
      },
      onEnd: () => {
        this.handle = null;
        this.advance();
      },
      onError: (msg) => {
        this.handle = null;
        this.lastError = msg;
        this.playing = false;
        this.stopTicker();
        this.emit();
      }
    });
  }

  private advance() {
    const next = this.currentIdx + 1;
    if (next >= this.sentences.length) {
      this.stopSpeaking();
      this.emit();
      return;
    }
    this.currentIdx = next;
    this.charIndex = 0;
    this.speakCurrent(0);
    this.emit();
  }

  private stopSpeaking() {
    this.handle?.cancel();
    this.handle = null;
    this.playing = false;
    this.stopKeepAlive?.();
    this.stopKeepAlive = null;
    this.stopTicker();
  }

  /**
   * Some engines emit no boundary events. Advance the estimate on a timer
   * so the progress bar still moves; real boundary events override it.
   */
  private startTicker() {
    if (this.tickId != null) return;
    this.tickId = window.setInterval(() => {
      if (!this.playing) return;
      const cur = this.sentences[this.currentIdx];
      if (!cur) return;
      const elapsed = (Date.now() - this.startedAt) / 1000;
      const estimate = this.baseChar + elapsed * CHARS_PER_SEC * this.rate;
      if (estimate > this.charIndex) {
        this.charIndex = Math.min(cur.text.length, Math.round(estimate));
        this.emit();
      }
    }, 250);
  }

  private stopTicker() {
    if (this.tickId != null) {
      clearInterval(this.tickId);
      this.tickId = null;
    }
  }

  private emit() {
    const s = this.state();
    for (const fn of this.listeners) fn(s);
  }
}

/** Which word contains charIndex, for highlighting. */
export function wordIndexAtChar(text: string, charIndex: number): number {
  if (charIndex <= 0) return 0;
  let idx = -1;
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    idx += 1;
    if (charIndex < m.index + m[0].length) return idx;
  }
  return Math.max(0, idx);
}
