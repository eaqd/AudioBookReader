/**
 * Lazy Kokoro-82M loader with progress reporting + CDN fallback.
 *
 * Why CDN-load kokoro-js at runtime instead of npm-bundling:
 * Bundling kokoro-js pulls in @huggingface/transformers + onnxruntime-web,
 * the latter ships a massive WGSL shader as an inline template literal
 * that crashes Next.js's SWC minifier. Loading via dynamic import with
 * `webpackIgnore` sidesteps the whole issue and lets the SW cache it once.
 *
 * Resilience:
 *  - Try jsDelivr first, fall back to esm.sh on import failure.
 *  - Surface descriptive error messages for AbortError / network errors
 *    (very common on cellular: 80MB model download is fragile).
 *  - Treat the model load itself as recoverable: callers see a typed
 *    error and can offer a retry button.
 */

import { putAudio } from "@/lib/storage/audio";
import { audioId, type AudioChunkRow } from "@/lib/storage/db";
import { floatTo16BitWavBlob } from "@/lib/audio/wav";
import { enforceMaxLength } from "@/lib/pdf/sentences";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

const CDN_URLS = [
  "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm",
  "https://esm.sh/kokoro-js@1.2.1?bundle"
];

/**
 * Maximum text length we send to Kokoro in a single forward pass. Long
 * inputs not only sound bad (no breath / pacing) but also stall the
 * synthesizer for many seconds. We split locally and concat audio.
 */
const SYNTH_CHUNK_CHAR_LIMIT = 320;

export type ModelDtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";
export type ModelDevice = "wasm" | "webgpu" | "cpu";

export interface ModelLoadProgress {
  status: "initiate" | "download" | "progress" | "done" | "ready";
  file?: string;
  loaded?: number;
  total?: number;
  fraction: number;
}

interface KokoroLike {
  generate: (text: string, options?: { voice?: string; speed?: number }) => Promise<{
    audio: Float32Array;
    sampling_rate: number;
  }>;
  voices: Record<string, unknown>;
}

interface KokoroModule {
  KokoroTTS: {
    from_pretrained: (
      id: string,
      opts: {
        dtype: ModelDtype;
        device: ModelDevice;
        progress_callback: (raw: unknown) => void;
      }
    ) => Promise<KokoroLike>;
  };
}

let _instance: KokoroLike | null = null;
let _loading: Promise<KokoroLike> | null = null;
let _voice: string | null = null;
let _device: ModelDevice | null = null;

export class ModelLoadError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ModelLoadError";
  }
}

export async function loadKokoro(
  options: {
    onProgress?: (p: ModelLoadProgress) => void;
    preferWebGPU?: boolean;
  } = {}
): Promise<void> {
  if (_instance) return;
  if (_loading) {
    await _loading;
    return;
  }

  const dtype = pickDtype();
  const device = await pickDevice(options.preferWebGPU ?? true);
  _device = device;

  const totalBytesByFile = new Map<string, number>();
  const loadedBytesByFile = new Map<string, number>();

  function fraction(): number {
    let total = 0;
    let loaded = 0;
    for (const v of totalBytesByFile.values()) total += v;
    for (const v of loadedBytesByFile.values()) loaded += v;
    if (total === 0) return 0;
    return Math.min(1, loaded / total);
  }

  _loading = (async () => {
    let mod: KokoroModule | null = null;
    let lastErr: unknown = null;
    for (const url of CDN_URLS) {
      try {
        mod = (await import(/* webpackIgnore: true */ url)) as KokoroModule;
        break;
      } catch (e) {
        lastErr = e;
        // Try the next CDN.
      }
    }
    if (!mod) {
      throw new ModelLoadError(describeLoadError(lastErr, "fetching the speech runtime"), lastErr);
    }

    try {
      const tts = await mod.KokoroTTS.from_pretrained(MODEL_ID, {
        dtype,
        device,
        progress_callback: (raw: unknown) => {
          if (!options.onProgress) return;
          const p = raw as {
            status: ModelLoadProgress["status"];
            file?: string;
            loaded?: number;
            total?: number;
          };
          if (p.file != null && p.total != null) totalBytesByFile.set(p.file, p.total);
          if (p.file != null && p.loaded != null) loadedBytesByFile.set(p.file, p.loaded);
          options.onProgress({
            status: p.status,
            file: p.file,
            loaded: p.loaded,
            total: p.total,
            fraction: fraction()
          });
        }
      });
      _instance = tts;
      return _instance;
    } catch (e) {
      // If WebGPU init blew up, retry once with WASM.
      if (device === "webgpu") {
        try {
          _device = "wasm";
          const tts = await mod.KokoroTTS.from_pretrained(MODEL_ID, {
            dtype,
            device: "wasm",
            progress_callback: () => {}
          });
          _instance = tts;
          return _instance;
        } catch (e2) {
          throw new ModelLoadError(
            describeLoadError(e2, "loading the speech model (WASM fallback)"),
            e2
          );
        }
      }
      throw new ModelLoadError(describeLoadError(e, "loading the speech model"), e);
    }
  })();

  try {
    await _loading;
  } finally {
    _loading = null;
  }
}

export function getDevice(): ModelDevice | null {
  return _device;
}

export function isKokoroReady(): boolean {
  return _instance != null;
}

export async function listVoices(): Promise<string[]> {
  if (!_instance) await loadKokoro();
  return Object.keys(_instance!.voices);
}

export function setActiveVoice(voice: string) {
  _voice = voice;
}

export function getActiveVoice(): string {
  return _voice ?? "af_bella";
}

/** Single-piece time budget. WASM on phone shouldn't exceed this for ≤320 chars. */
const SYNTH_PIECE_TIMEOUT_MS = 60_000;

export interface SynthProgress {
  /** Index of the piece we're currently synthesizing (1-based for display). */
  piece: number;
  /** Total pieces this sentence is split into. */
  total: number;
}

/** Synthesize one sentence; persists the result to IndexedDB. */
export async function synthesize(
  bookId: string,
  chapterId: string,
  sentenceIdx: number,
  text: string,
  voice: string,
  options: { onProgress?: (p: SynthProgress) => void } = {}
): Promise<AudioChunkRow> {
  if (!_instance) {
    throw new Error("Kokoro is not loaded. Call loadKokoro() first.");
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Cannot synthesize empty text.");
  }

  const pieces =
    trimmed.length <= SYNTH_CHUNK_CHAR_LIMIT
      ? [trimmed]
      : enforceMaxLength([trimmed], SYNTH_CHUNK_CHAR_LIMIT);

  const buffers: Float32Array[] = [];
  let sampleRate = 24000;
  for (let i = 0; i < pieces.length; i++) {
    options.onProgress?.({ piece: i + 1, total: pieces.length });
    const piece = pieces[i];
    const result = await withTimeout(
      _instance.generate(piece, { voice, speed: 1.0 }),
      SYNTH_PIECE_TIMEOUT_MS,
      `Speech synthesis stalled on a ${piece.length}-char chunk after ${SYNTH_PIECE_TIMEOUT_MS / 1000}s.`
    );
    buffers.push(result.audio);
    sampleRate = result.sampling_rate;
  }

  const total = buffers.reduce((n, b) => n + b.length, 0);
  const merged = new Float32Array(total);
  let off = 0;
  for (const b of buffers) {
    merged.set(b, off);
    off += b.length;
  }

  const blob = floatTo16BitWavBlob(merged, sampleRate);
  const row: AudioChunkRow = {
    id: audioId(bookId, chapterId, sentenceIdx),
    bookId,
    chapterId,
    sentenceIdx,
    voice,
    duration: merged.length / sampleRate,
    blob
  };
  await putAudio(row);
  return row;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(message));
    }, ms);
    p.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/* ----------------------------- helpers ------------------------------- */

function describeLoadError(e: unknown, context: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : "";
  if (name === "AbortError" || /aborted/i.test(msg)) {
    return `${context}: the connection was cut off mid-download. This often happens on cellular — try again on Wi-Fi.`;
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return `${context}: network error. Check your connection and try again.`;
  }
  if (/cors/i.test(msg)) {
    return `${context}: blocked by browser security. Try a hard reload.`;
  }
  return `${context}: ${msg || "unknown error"}`;
}

function pickDtype(): ModelDtype {
  // q8 is small enough for mobile, fast on WASM, still natural-sounding.
  return "q8";
}

async function pickDevice(preferWebGPU: boolean): Promise<ModelDevice> {
  if (preferWebGPU && (await hasWebGPU())) return "webgpu";
  return "wasm";
}

async function hasWebGPU(): Promise<boolean> {
  try {
    const nav = navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } };
    if (!nav.gpu) return false;
    const adapter = await nav.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}
