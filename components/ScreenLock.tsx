"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Pocket lock.
 *
 * Covers the reader with an opaque layer that swallows taps, so the phone
 * can go in a pocket without scrubbing, pausing or navigating. Playback is
 * untouched — the overlay is purely a UI shield.
 *
 * Unlock is a deliberate press-and-hold rather than a tap, because a tap
 * is exactly what fabric produces.
 */

const HOLD_MS = 800;

export function ScreenLock({
  bookTitle,
  chapterTitle,
  playing,
  onUnlock,
  onTogglePlay
}: {
  bookTitle: string;
  chapterTitle: string;
  playing: boolean;
  onUnlock: () => void;
  onTogglePlay: () => void;
}) {
  const [held, setHeld] = useState(0);
  const timer = useRef<number | null>(null);
  const start = useRef(0);

  // Dim the screen a little; keeps OLED burn down and saves battery.
  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "#000";
    return () => {
      document.body.style.backgroundColor = prev;
    };
  }, []);

  function beginHold() {
    start.current = Date.now();
    if (timer.current != null) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      const pct = Math.min(1, (Date.now() - start.current) / HOLD_MS);
      setHeld(pct);
      if (pct >= 1) {
        endHold();
        onUnlock();
      }
    }, 30);
  }

  function endHold() {
    if (timer.current != null) window.clearInterval(timer.current);
    timer.current = null;
    setHeld(0);
  }

  useEffect(() => {
    return () => {
      if (timer.current != null) window.clearInterval(timer.current);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center select-none touch-none"
      // Block every stray gesture that reaches the shield.
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      role="dialog"
      aria-label="Screen locked"
    >
      <div className="flex flex-col items-center gap-2 px-8 text-center">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" className="text-accent" aria-hidden>
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        <p className="text-[10px] uppercase tracking-[0.25em] text-subtle mt-2">
          Screen locked
        </p>
        <p className="text-base font-semibold text-text/90 line-clamp-2">{bookTitle}</p>
        <p className="text-xs text-muted line-clamp-1">{chapterTitle}</p>
        <p className="text-[11px] text-subtle mt-1">
          {playing ? "Playing" : "Paused"}
        </p>
      </div>

      {/* Deliberately small and low: hard to hit by accident in a pocket. */}
      <div className="absolute bottom-16 flex flex-col items-center gap-5">
        <button
          onClick={onTogglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="h-11 w-11 rounded-full grid place-items-center bg-white/10 text-text/70 active:bg-white/20"
        >
          {playing ? (
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
              <path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
              <path fill="currentColor" d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <button
          onPointerDown={beginHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          className="relative h-14 w-44 rounded-full bg-white/5 grid place-items-center overflow-hidden active:bg-white/10"
          aria-label="Hold to unlock"
        >
          <span
            className="absolute left-0 top-0 bottom-0 bg-accent/30 transition-none"
            style={{ width: `${held * 100}%` }}
          />
          <span className="relative text-xs text-muted tracking-wide">
            {held > 0 ? "Keep holding…" : "Hold to unlock"}
          </span>
        </button>
      </div>
    </div>
  );
}
