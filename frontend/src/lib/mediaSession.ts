import type { BookDetail, SectionOut } from "../types";

export function setMediaSession(
  book: BookDetail,
  currentSection: SectionOut | undefined,
  handlers: {
    play: () => void;
    pause: () => void;
    seekRelative: (deltaSec: number) => void;
    seekAbsolute: (sec: number) => void;
  }
): void {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  ms.metadata = new MediaMetadata({
    title: book.title,
    artist: book.author ?? "Unknown",
    album: currentSection?.title ?? book.title,
    artwork: book.cover_url
      ? [{ src: book.cover_url, sizes: "512x512", type: "image/png" }]
      : []
  });
  ms.setActionHandler("play", () => handlers.play());
  ms.setActionHandler("pause", () => handlers.pause());
  ms.setActionHandler("seekbackward", (d) =>
    handlers.seekRelative(-(d.seekOffset ?? 15))
  );
  ms.setActionHandler("seekforward", (d) =>
    handlers.seekRelative(+(d.seekOffset ?? 15))
  );
  try {
    ms.setActionHandler("seekto", (d) => {
      if (typeof d.seekTime === "number") handlers.seekAbsolute(d.seekTime);
    });
  } catch {
    // not all browsers
  }
}

export function setPlaybackState(state: "playing" | "paused" | "none"): void {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = state;
}

export function setPositionState(durationSec: number, positionSec: number, rate: number): void {
  if (!("mediaSession" in navigator)) return;
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
