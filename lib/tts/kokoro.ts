/**
 * Lazy Kokoro-82M loader with progress reporting.
 *
 * Model files are fetched from Hugging Face on first use; transformers.js
 * caches them automatically in IndexedDB so subsequent loads are instant.
 *
 * Why CDN-load kokoro-js at runtime instead of npm-bundling:
 * Bundling kokoro-js pulls in @huggingface/transformers + onnxruntime-web,
 * the latter ships a massive WGSL shader as an inline template literal
 * that crashes Next.js's SWC minifier. Loading from jsDelivr's `+esm`
 * endpoint sidesteps the whole issue and lets the SW cache it once.
 */

import { putAudio } from "@/lib/storage/audio";
import { audioId, type AudioChunkRow } from "@/lib/storage/db";
import { floatTo16BitWavBlob } from "@/lib/audio/wav";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_CDN_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";

export type ModelDtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";
export type ModelDevice = "wasm" | "webgpu" | "cpu";

export interface ModelLoadProgress {
  /** transformers.js status string. */
  status: "initiate" | "download" | "progress" | "done" | "ready";
  file?: string;
  loaded?: number;
  total?: number;
  /** 0..1, computed on each tick. */
  fraction: number;
}

interface KokoroLike {
  generate: (text: string, options?: { voice?: string; speed?: number }) => Promise<{
    audio: Float32Array;
    sampling_rate: number;
  }>;
  voices: Record<string, unknown>;
}

let _instance: KokoroLike | null = null;
let _loading: Promise<KokoroLike> | null = null;
let _voice: string | null = null;
let _device: ModelDevice | null = null;

export async function loadKokoro(
  options: {
    onProgress?: (p: ModelLoadProgress) => void;
    /** prefer WebGPU when available, fallback to WASM. */
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
    const mod = (await import(/* webpackIgnore: true */ KOKORO_CDN_URL)) as {
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
    };
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

/**
 * Synthesize one sentence; persists the result to IndexedDB.
 */
export async function synthesize(
  bookId: string,
  chapterId: string,
  sentenceIdx: number,
  text: string,
  voice: string
): Promise<AudioChunkRow> {
  if (!_instance) {
    throw new Error("Kokoro is not loaded. Call loadKokoro() first.");
  }
  const result = await _instance.generate(text, { voice, speed: 1.0 });
  const audio = result.audio;
  const sampleRate = result.sampling_rate;
  const blob = floatTo16BitWavBlob(audio, sampleRate);
  const row: AudioChunkRow = {
    id: audioId(bookId, chapterId, sentenceIdx),
    bookId,
    chapterId,
    sentenceIdx,
    voice,
    duration: audio.length / sampleRate,
    blob
  };
  await putAudio(row);
  return row;
}

/* ----------------------------- helpers ------------------------------- */

function pickDtype(): ModelDtype {
  // Mobile (especially iOS) does best with q8 — small and fast, quality
  // is still natural. Desktop with WebGPU can afford fp32 but q8 is fine.
  if (typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
    return "q8";
  }
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
