import type { PlayerEngine } from "./engine";

interface SessionMetadata {
  title: string;
  author?: string;
  album?: string;
  artworkDataUrl?: string;
}

export function bindMediaSession(engine: PlayerEngine, meta: SessionMetadata) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return () => {};
  const ms = navigator.mediaSession;

  ms.metadata = new MediaMetadata({
    title: meta.title,
    artist: meta.author ?? "",
    album: meta.album ?? meta.title,
    artwork: meta.artworkDataUrl
      ? [{ src: meta.artworkDataUrl, sizes: "512x512", type: "image/png" }]
      : []
  });

  const handlers: Array<[MediaSessionAction, () => void]> = [
    ["play", () => void engine.play()],
    ["pause", () => engine.pause()],
    ["seekbackward", () => void engine.skipBySeconds(-15)],
    ["seekforward", () => void engine.skipBySeconds(+15)],
    ["previoustrack", () => engine.prevSentence()],
    ["nexttrack", () => engine.nextSentence()]
  ];
  for (const [action, fn] of handlers) {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* unsupported action */
    }
  }

  return () => {
    for (const [action] of handlers) {
      try {
        ms.setActionHandler(action, null);
      } catch {
        /* ignore */
      }
    }
  };
}

export function setMediaPlaybackState(state: "playing" | "paused" | "none") {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = state;
}

export function setMediaPositionState(durationSec: number, positionSec: number, rate: number) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: Math.max(0, durationSec),
      position: Math.max(0, Math.min(positionSec, durationSec)),
      playbackRate: rate
    });
  } catch {
    /* iOS sometimes throws on too-frequent updates */
  }
}
