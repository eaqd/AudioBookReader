/**
 * Device text-to-speech via the Web Speech API.
 *
 * Replaces the in-browser Kokoro ONNX pipeline. Measured on desktop
 * Chrome, Kokoro generated 3.73s of audio in 17.2s — 4.6x slower than
 * realtime — so synthesising during playback could never keep up, and on
 * a phone it was minutes per sentence. The device's own voices are
 * instant, free, need no 80MB download, and modern iOS/Android neural
 * voices sound good.
 *
 * Known tradeoff: speech is bound to the page, so it stops when an iOS
 * screen locks. Background/lock-screen playback is not achievable with
 * this API.
 */

export interface DeviceVoice {
  /** voiceURI — stable identifier used for persistence. */
  id: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Voice lists populate asynchronously; Chrome fires `voiceschanged` and
 * iOS Safari often returns [] on the first call. Poll briefly.
 */
export function listVoices(timeoutMs = 2000): Promise<DeviceVoice[]> {
  return new Promise((resolve) => {
    if (!speechSupported()) return resolve([]);
    const synth = window.speechSynthesis;

    const collect = () => {
      const raw = synth.getVoices();
      return raw.map((v) => ({
        id: v.voiceURI,
        name: v.name,
        lang: v.lang,
        localService: v.localService,
        default: v.default
      }));
    };

    const first = collect();
    if (first.length) return resolve(first);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener("voiceschanged", finish);
      clearInterval(poll);
      clearTimeout(timer);
      resolve(collect());
    };
    synth.addEventListener("voiceschanged", finish);
    const poll = setInterval(() => {
      if (collect().length) finish();
    }, 100);
    const timer = setTimeout(finish, timeoutMs);
  });
}

/** Pick the nicest-sounding English voice available on this device. */
export function pickDefaultVoice(voices: DeviceVoice[]): string | null {
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = en.length ? en : voices;
  // Apple's premium/enhanced voices and Google's network voices are the
  // most natural; prefer them, then any local English voice.
  const preferred = [
    /siri/i, /premium/i, /enhanced/i, /neural/i,
    /^Google (US|UK) English/i, /Samantha/i, /Daniel/i
  ];
  for (const re of preferred) {
    const hit = pool.find((v) => re.test(v.name));
    if (hit) return hit.id;
  }
  return (pool.find((v) => v.default) ?? pool[0]).id;
}

export function resolveVoice(id: string | null): SpeechSynthesisVoice | null {
  if (!speechSupported() || !id) return null;
  return window.speechSynthesis.getVoices().find((v) => v.voiceURI === id) ?? null;
}

/**
 * Speak one chunk of text.
 *
 * onBoundary reports the character offset reached, which drives word
 * highlighting. Some engines never emit boundary events — callers must
 * treat highlighting as best-effort and rely on onEnd for sequencing.
 */
export interface SpeakHandle {
  cancel(): void;
}

export function speak(
  text: string,
  opts: {
    voiceId: string | null;
    rate: number;
    onBoundary?: (charIndex: number) => void;
    onEnd?: () => void;
    onError?: (message: string) => void;
  }
): SpeakHandle {
  if (!speechSupported()) {
    opts.onError?.("This browser has no speech synthesis.");
    return { cancel() {} };
  }
  const synth = window.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text);
  const v = resolveVoice(opts.voiceId);
  if (v) u.voice = v;
  u.rate = Math.max(0.1, Math.min(10, opts.rate));
  u.pitch = 1;
  u.volume = 1;
  if (v?.lang) u.lang = v.lang;

  let finished = false;
  u.onboundary = (e) => {
    if (typeof e.charIndex === "number") opts.onBoundary?.(e.charIndex);
  };
  u.onend = () => {
    if (finished) return;
    finished = true;
    opts.onEnd?.();
  };
  u.onerror = (e) => {
    if (finished) return;
    finished = true;
    // "interrupted"/"canceled" are our own cancel() calls, not failures.
    const err = (e as SpeechSynthesisErrorEvent).error;
    if (err === "interrupted" || err === "canceled") return;
    opts.onError?.(String(err || "speech failed"));
  };

  // Chrome occasionally wedges if speak() is called while a previous
  // utterance is still winding down.
  try {
    synth.cancel();
  } catch {
    /* ignore */
  }
  synth.speak(u);

  return {
    cancel() {
      finished = true;
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
    }
  };
}

/**
 * iOS requires the first speak() to happen inside a user gesture. Firing
 * a zero-length utterance on the first tap unlocks the engine for the
 * rest of the session.
 */
let unlocked = false;
export function primeSpeech(): void {
  if (unlocked || !speechSupported()) return;
  unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

/** Chrome pauses long-running synthesis after ~15s unless nudged. */
export function startKeepAlive(): () => void {
  if (!speechSupported()) return () => {};
  const id = setInterval(() => {
    const s = window.speechSynthesis;
    if (s.speaking && !s.paused) {
      try {
        s.pause();
        s.resume();
      } catch {
        /* ignore */
      }
    }
  }, 10_000);
  return () => clearInterval(id);
}
