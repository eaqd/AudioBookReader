import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { api } from "../lib/api";
import { AudioBookPlayer } from "../lib/player";
import {
  setMediaSession,
  setPlaybackState,
  setPositionState
} from "../lib/mediaSession";
import {
  flushProgressNow,
  loadProgress,
  saveProgressDebounced
} from "../lib/progress";
import { downloadBookForOffline, isBookCached } from "../lib/offline";
import { loadSettings, saveSettings } from "../lib/db";
import { useReader, cumulativeMsBefore } from "../store/reader";
import { ChunkText } from "../components/ChunkText";
import { Player } from "../components/Player";
import { TocDrawer } from "../components/TocDrawer";
import type { BookDetail, ChunkOut, SectionOut } from "../types";

export function ReaderPage(): JSX.Element {
  const { bookId } = useParams({ from: "/book/$bookId" });
  const r = useReader();
  const [book, setBook] = useState<BookDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [position, setPosition] = useState({ sec: 0, dur: 0 });
  const [chunkCache, setChunkCache] = useState<Map<string, ChunkOut>>(new Map());
  const [followMode, setFollowMode] = useState(true);
  const [downloadState, setDownloadState] = useState<
    | { state: "idle" }
    | { state: "downloading"; done: number; total: number }
    | { state: "cached" }
    | { state: "error"; msg: string }
  >({ state: "idle" });

  const playerRef = useRef<AudioBookPlayer | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sleepTimerRef = useRef<{ until: number; id: number } | null>(null);
  const [sleepRemainingMs, setSleepRemainingMs] = useState<number | null>(null);

  // ---------- player setup ----------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const detail = await api.getBook(bookId);
        if (cancelled) return;
        if (detail.status !== "ready") {
          setError(`Book is ${detail.status}. Try again when processing finishes.`);
          return;
        }
        setBook(detail);
        r.setBook(detail);

        const settings = await loadSettings();
        setFollowMode(settings.followMode);
        r.setFollow(settings.followMode);
        r.setRate(settings.defaultRate);

        const player = new AudioBookPlayer({
          onChunkChange: (chunk, idx) => {
            useReader.getState().setChunk(chunk, idx);
            setChunkCache((m) => {
              const next = new Map(m);
              next.set(chunk.id, chunk);
              return next;
            });
            // Update Media Session metadata when chapter changes
            const sec = detail.sections.find((s) => s.id === chunk.section_id);
            setMediaSession(detail, sec, {
              play: () => player.play(),
              pause: () => player.pause(),
              seekRelative: (d) => player.seekRelative(d),
              seekAbsolute: (t) => player.seekToChunk(chunk.id, t)
            });
            setPosition({ sec: 0, dur: chunk.duration_ms / 1000 });
          },
          onWordTick: (chunkId, wordIdx, t) => {
            const live = useReader.getState();
            live.setWord(wordIdx);
            const cur = live.book?.chunks ?? detail.chunks;
            const idx = cur.find((c) => c.id === chunkId)?.idx ?? 0;
            const elapsed = cumulativeMsBefore(cur, idx) + Math.round(t * 1000);
            live.setElapsed(elapsed);
            setPosition((p) => ({ ...p, sec: t }));
            setPositionState(detail.total_duration_ms / 1000, elapsed / 1000, live.rate);
            saveProgressDebounced({
              bookId,
              chunkId,
              offsetMs: Math.round(t * 1000),
              wordIdx,
              updatedAt: Date.now()
            });
          },
          onPlayState: (playing) => {
            useReader.getState().setPlaying(playing);
            setPlaybackState(playing ? "playing" : "paused");
          },
          onBookEnd: () => useReader.getState().setPlaying(false),
          onError: (msg) => setError(msg)
        });
        player.setRate(settings.defaultRate);
        player.setBook(
          bookId,
          detail.chunks.map((c) => ({ id: c.id, idx: c.idx }))
        );
        playerRef.current = player;

        // Cached?
        void isBookCached(bookId).then((cached) =>
          setDownloadState(cached ? { state: "cached" } : { state: "idle" })
        );

        // Resume position
        const resume = await loadProgress(bookId);
        const startChunk =
          resume?.chunkId ?? detail.chunks[0]?.id ?? null;
        if (startChunk) {
          await player.seekToChunk(
            startChunk,
            (resume?.offsetMs ?? 0) / 1000,
            false
          );
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      void flushProgressNow();
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // ---------- follow-mode autoscroll ----------
  useEffect(() => {
    if (!followMode || !r.chunk || r.activeWordIdx < 0) return;
    const sel = `[data-cid="${r.chunk.id}"][data-w="${r.activeWordIdx}"]`;
    const el = containerRef.current?.querySelector(sel) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [r.activeWordIdx, r.chunk, followMode]);

  // Disable follow when user scrolls manually
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastTop = el.scrollTop;
    let manual = false;
    const onScroll = () => {
      // Detect a manual scroll (>40px from last "auto" scroll snapshot).
      if (Math.abs(el.scrollTop - lastTop) > 40 && !manual) {
        manual = true;
        setFollowMode(false);
        void saveSettings({ followMode: false });
      }
      lastTop = el.scrollTop;
      // reset manual flag after a beat
      window.setTimeout(() => (manual = false), 250);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // ---------- tap-to-seek ----------
  const onClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const word = t.closest("[data-w]") as HTMLElement | null;
    if (!word) return;
    const cid = word.getAttribute("data-cid");
    const w = word.getAttribute("data-w");
    if (!cid || w == null) return;
    void playerRef.current?.seekToWord(cid, parseInt(w, 10), true);
  }, []);

  // ---------- preload neighboring chunks for visible text ----------
  const visibleChunks = useMemo(() => {
    if (!book || !r.chunk) return [];
    // Show the current chunk + a small window for context
    const idx = r.currentIdxInBook;
    const pre = 3;
    const post = 8;
    const start = Math.max(0, idx - pre);
    const end = Math.min(book.chunks.length, idx + post);
    return book.chunks.slice(start, end);
  }, [book, r.chunk, r.currentIdxInBook]);

  useEffect(() => {
    if (!book) return;
    visibleChunks.forEach((entry) => {
      if (chunkCache.has(entry.id)) return;
      void api.getChunk(book.id, entry.id).then((c) => {
        setChunkCache((m) => {
          const next = new Map(m);
          next.set(c.id, c);
          return next;
        });
      });
    });
  }, [book, visibleChunks, chunkCache]);

  // ---------- callbacks ----------
  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    p.isPlaying() ? p.pause() : void p.play();
  };

  const onSeekChunk = (sec: number) => {
    const cid = r.chunk?.id;
    if (!cid) return;
    void playerRef.current?.seekToChunk(cid, sec, r.playing);
  };

  const onChangeRate = (rate: number) => {
    playerRef.current?.setRate(rate);
    r.setRate(rate);
    void saveSettings({ defaultRate: rate });
  };

  const onSelectSection = async (s: SectionOut) => {
    setTocOpen(false);
    if (!s.start_chunk_id) return;
    await playerRef.current?.seekToChunk(s.start_chunk_id, 0, true);
  };

  const onSleepTimer = (minutes: number) => {
    if (sleepTimerRef.current) {
      clearTimeout(sleepTimerRef.current.id);
      sleepTimerRef.current = null;
    }
    if (minutes <= 0) {
      setSleepRemainingMs(null);
      return;
    }
    const until = Date.now() + minutes * 60_000;
    const id = window.setTimeout(() => {
      playerRef.current?.pause();
      sleepTimerRef.current = null;
      setSleepRemainingMs(null);
      void flushProgressNow();
    }, minutes * 60_000);
    sleepTimerRef.current = { until, id };
    setSleepRemainingMs(until - Date.now());
  };

  // tick the sleep timer remaining display
  useEffect(() => {
    if (!sleepTimerRef.current) return;
    const id = setInterval(() => {
      if (!sleepTimerRef.current) return;
      const rem = sleepTimerRef.current.until - Date.now();
      setSleepRemainingMs(rem > 0 ? rem : null);
    }, 30_000);
    return () => clearInterval(id);
  }, [sleepRemainingMs]);

  const onDownload = async () => {
    if (!book) return;
    setDownloadState({ state: "downloading", done: 0, total: book.chunks.length });
    try {
      await downloadBookForOffline(book.id, (done, total) =>
        setDownloadState({ state: "downloading", done, total })
      );
      setDownloadState({ state: "cached" });
    } catch (e) {
      setDownloadState({ state: "error", msg: (e as Error).message });
    }
  };

  // ---------- render ----------
  if (error) {
    return (
      <div className="p-6">
        <Link to="/" className="text-sm opacity-70">← Library</Link>
        <p className="mt-3 text-red-500">{error}</p>
      </div>
    );
  }
  if (!book || !r.chunk) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="opacity-70">Loading…</p>
      </div>
    );
  }

  const currentSection = book.sections.find((s) => s.id === r.chunk!.section_id);

  return (
    <div className="flex flex-col h-screen">
      <header className="px-4 pt-4 pb-2 flex items-center justify-between safe-top">
        <Link to="/" className="text-sm opacity-70">← Library</Link>
        <div className="text-center min-w-0 px-3">
          <div className="text-sm font-medium truncate">{book.title}</div>
          {currentSection && (
            <div className="text-[11px] opacity-60 truncate">
              {currentSection.title}
            </div>
          )}
        </div>
        <button
          onClick={onDownload}
          className="text-xs opacity-80 px-2 py-1 rounded-md hover:bg-current/10"
        >
          {downloadState.state === "cached"
            ? "✓ Offline"
            : downloadState.state === "downloading"
              ? `${Math.round((downloadState.done / Math.max(1, downloadState.total)) * 100)}%`
              : "↓ Save"}
        </button>
      </header>

      <div
        ref={containerRef}
        onClick={onClick}
        className="flex-1 overflow-auto px-5 reader-text no-scrollbar"
      >
        <div className="max-w-2xl mx-auto py-4">
          {currentSection && (
            <h2 className="text-lg font-semibold sticky top-0 bg-paper dark:bg-ink py-2 -mx-2 px-2">
              {currentSection.title}
            </h2>
          )}
          {visibleChunks.map((entry) => {
            const ck = chunkCache.get(entry.id);
            if (!ck) {
              return (
                <p key={entry.id} className="paragraph opacity-30">
                  …
                </p>
              );
            }
            return (
              <ChunkText
                key={ck.id}
                chunk={ck}
                isCurrentChunk={ck.id === r.chunk?.id}
                activeWordIdx={r.activeWordIdx}
              />
            );
          })}
        </div>

        {!followMode && r.playing && (
          <button
            onClick={() => {
              setFollowMode(true);
              void saveSettings({ followMode: true });
            }}
            className="fixed left-1/2 -translate-x-1/2 bottom-32 z-20 text-xs px-3 py-1.5 rounded-full bg-indigo-600 text-white shadow-lg"
          >
            Jump to current
          </button>
        )}
      </div>

      <Player
        playing={r.playing}
        rate={r.rate}
        positionSec={position.sec}
        durationSec={position.dur || (r.chunk.duration_ms / 1000)}
        totalElapsedMs={r.totalElapsedMs}
        totalDurationMs={r.totalDurationMs}
        onPlayPause={togglePlay}
        onBack15={() => playerRef.current?.seekRelative(-15)}
        onFwd15={() => playerRef.current?.seekRelative(+15)}
        onSeekChunk={onSeekChunk}
        onChangeRate={onChangeRate}
        onOpenToc={() => setTocOpen(true)}
        onSleepTimer={onSleepTimer}
        sleepRemainingMs={sleepRemainingMs}
      />

      <TocDrawer
        open={tocOpen}
        sections={book.sections}
        currentSectionId={currentSection?.id ?? null}
        onClose={() => setTocOpen(false)}
        onSelect={onSelectSection}
      />
    </div>
  );
}
