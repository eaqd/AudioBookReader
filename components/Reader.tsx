"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextPane } from "./TextPane";
import { PlayerBar } from "./PlayerBar";
import { SectionNav } from "./SectionNav";
import { CoverArt } from "./CoverArt";
import { PlayerEngine, type EngineState, type SentenceRef } from "@/lib/player/engine";
import {
  bindMediaSession,
  setMediaPlaybackState,
  setMediaPositionState
} from "@/lib/player/mediaSession";
import { loadKokoro, type ModelLoadProgress } from "@/lib/tts/kokoro";
import {
  loadProgress,
  saveProgressDebounced,
  flushProgressNow
} from "@/lib/storage/progress";
import { getBook, getBookContent } from "@/lib/storage/books";
import type { BookContentRow, BookRow, ChapterPayload } from "@/lib/storage/db";

interface ReaderProps {
  bookId: string;
}

interface LoadedBook {
  book: BookRow;
  content: BookContentRow;
  flat: SentenceRef[];
  estChapterDurSec: number[];
  estChapterStartSec: number[];
}

const ESTIMATED_CHARS_PER_SECOND = 14;

export function Reader({ bookId }: ReaderProps) {
  const [loaded, setLoaded] = useState<LoadedBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<
    | { phase: "idle" }
    | { phase: "loading"; progress: number; file?: string }
    | { phase: "ready" }
    | { phase: "error"; message: string }
  >({ phase: "idle" });
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  const [sleepRemainingMs, setSleepRemainingMs] = useState<number | null>(null);
  const sleepTimerRef = useRef<{ until: number; id: number; endOfChapter: boolean } | null>(null);

  const engineRef = useRef<PlayerEngine | null>(null);
  const lastUserScrollRef = useRef(0);

  /* -------- 1. Load book content from IDB -------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const book = await getBook(bookId);
        if (!book) {
          setError("Book not found in your library.");
          return;
        }
        const content = await getBookContent(bookId);
        if (!content) {
          setError("Book content missing — try re-uploading the PDF.");
          return;
        }
        const flat = flattenSentences(content.chapters);
        const estChapterDurSec = content.chapters.map((c) =>
          c.sentences.reduce((s, t) => s + Math.max(0.4, t.length / ESTIMATED_CHARS_PER_SECOND), 0)
        );
        const estChapterStartSec = cumStartSec(estChapterDurSec);
        if (alive) {
          setLoaded({ book, content, flat, estChapterDurSec, estChapterStartSec });
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookId]);

  /* -------- 2. Set up player engine once book is loaded -------- */
  useEffect(() => {
    if (!loaded || engineRef.current) return;
    const eng = new PlayerEngine({
      bookId: loaded.book.id,
      voice: loaded.book.voice
    });
    eng.setSentences(loaded.flat);
    engineRef.current = eng;

    const unsub = eng.subscribe((s) => {
      setEngineState(s);
      setMediaPlaybackState(s.playing ? "playing" : "paused");
      const totalDur = sumEstimated(loaded);
      const totalPos = computeTotalPos(loaded, s);
      setMediaPositionState(totalDur, totalPos, s.rate);

      // persist progress (debounced)
      if (s.current) {
        saveProgressDebounced({
          bookId: loaded.book.id,
          chapterId: s.current.chapterId,
          sentenceIdx: s.current.sentenceIdx,
          offsetSec: s.positionSec
        });
      }
    });

    // restore last position
    (async () => {
      const p = await loadProgress(loaded.book.id);
      const startIdx = p
        ? loaded.flat.findIndex(
            (sr) => sr.chapterId === p.chapterId && sr.sentenceIdx === p.sentenceIdx
          )
        : 0;
      const idx = startIdx >= 0 ? startIdx : 0;
      // We can't autoplay before user gesture; just position the engine.
      await eng.seekToSentence(idx, false);
      if (p?.offsetSec) eng.seekWithinSentence(p.offsetSec);
    })();

    return () => {
      unsub();
      void flushProgressNow();
      eng.destroy();
      engineRef.current = null;
    };
  }, [loaded]);

  /* -------- 3. Bind MediaSession metadata when chapter changes -------- */
  useEffect(() => {
    if (!loaded || !engineRef.current || !engineState?.current) return;
    const ch = loaded.content.chapters[engineState.current.chapterIdx];
    if (!ch) return;
    const unbind = bindMediaSession(engineRef.current, {
      title: loaded.book.title,
      author: undefined,
      album: ch.title
    });
    return unbind;
  }, [loaded, engineState?.current?.chapterIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  /* -------- 4. Sleep timer ticker -------- */
  useEffect(() => {
    if (!sleepTimerRef.current) return;
    const id = window.setInterval(() => {
      const t = sleepTimerRef.current;
      if (!t) return;
      const rem = t.until - Date.now();
      setSleepRemainingMs(rem > 0 ? rem : null);
    }, 30_000);
    return () => clearInterval(id);
  }, [sleepRemainingMs]);

  /* -------- callbacks -------- */

  const ensureModelLoaded = useCallback(async () => {
    if (modelStatus.phase === "ready") return true;
    setModelStatus({ phase: "loading", progress: 0 });
    try {
      await loadKokoro({
        onProgress: (p: ModelLoadProgress) => {
          setModelStatus({
            phase: "loading",
            progress: p.fraction,
            file: p.file
          });
        }
      });
      setModelStatus({ phase: "ready" });
      return true;
    } catch (e) {
      setModelStatus({ phase: "error", message: (e as Error).message });
      return false;
    }
  }, [modelStatus.phase]);

  const togglePlay = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.isPlaying()) {
      eng.pause();
      return;
    }
    // First press: ensure model loaded, then play.
    const ok = await ensureModelLoaded();
    if (!ok) return;
    try {
      await eng.play();
    } catch (e) {
      setModelStatus({ phase: "error", message: (e as Error).message });
    }
  }, [ensureModelLoaded]);

  const onSeekTextSentence = useCallback(
    async (chapterIdx: number, sentenceIdx: number) => {
      if (!loaded || !engineRef.current) return;
      const ok = await ensureModelLoaded();
      if (!ok) return;
      const target = loaded.flat.find(
        (s) => s.chapterIdx === chapterIdx && s.sentenceIdx === sentenceIdx
      );
      if (!target) return;
      await engineRef.current.seekToSentence(target.globalIdx, true);
    },
    [loaded, ensureModelLoaded]
  );

  const onChangeRate = useCallback((r: number) => {
    engineRef.current?.setRate(r);
  }, []);

  const onSleep = useCallback(
    (minutes: number, endOfChapter: boolean) => {
      if (sleepTimerRef.current) {
        clearTimeout(sleepTimerRef.current.id);
        sleepTimerRef.current = null;
      }
      if (minutes <= 0 && !endOfChapter) {
        setSleepRemainingMs(null);
        return;
      }
      if (endOfChapter) {
        // pause when chapter changes (handled by engineState effect below)
        sleepTimerRef.current = { until: Number.POSITIVE_INFINITY, id: -1, endOfChapter: true };
        setSleepRemainingMs(0);
        return;
      }
      const until = Date.now() + minutes * 60_000;
      const id = window.setTimeout(() => {
        engineRef.current?.pause();
        sleepTimerRef.current = null;
        setSleepRemainingMs(null);
        void flushProgressNow();
      }, minutes * 60_000);
      sleepTimerRef.current = { until, id, endOfChapter: false };
      setSleepRemainingMs(until - Date.now());
    },
    []
  );

  // End-of-chapter sleep watcher
  useEffect(() => {
    const t = sleepTimerRef.current;
    if (!t || !t.endOfChapter || !engineState?.current || !loaded) return;
    const cur = engineState.current;
    // pause as soon as we enter the *next* chapter
    if (cur.sentenceIdx === 0 && cur.chapterIdx > 0) {
      const prevIdx = loaded.flat.findIndex(
        (s) => s.chapterIdx === cur.chapterIdx - 1 && s.sentenceIdx === 0
      );
      if (prevIdx >= 0) {
        engineRef.current?.pause();
        sleepTimerRef.current = null;
        setSleepRemainingMs(null);
      }
    }
  }, [engineState?.current, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  /* -------- render -------- */

  if (error) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Link href="/" className="text-sm text-muted">← Library</Link>
        <p className="mt-3 text-red-300">{error}</p>
      </div>
    );
  }

  if (!loaded || !engineState) {
    return <FullScreenLoading message="Opening book…" />;
  }

  const cur = engineState.current;
  const chapterIdx = cur?.chapterIdx ?? 0;
  const sentenceIdx = cur?.sentenceIdx ?? 0;
  const chapterDur = loaded.estChapterDurSec[chapterIdx] ?? 0;
  const chapterPos = chapterPosSec(loaded, chapterIdx, sentenceIdx, engineState.positionSec);

  return (
    <div className="flex flex-col h-screen safe-top">
      <header className="px-4 sm:px-6 pt-4 pb-2 flex items-center gap-3">
        <Link href="/" className="text-sm text-muted hover:text-text shrink-0">
          ← Library
        </Link>
        <div className="flex-1 min-w-0 flex items-center gap-3 justify-center">
          <CoverArt title={loaded.book.title} size="sm" className="!h-8 !w-8 !rounded-md !text-sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{loaded.book.title}</p>
            <p className="text-[11px] text-muted truncate">
              {loaded.content.chapters[chapterIdx]?.title ?? ""}
            </p>
          </div>
        </div>
        <button
          onClick={() => setFollow((v) => !v)}
          className={
            "shrink-0 text-xs px-2 py-1 rounded-md " +
            (follow ? "bg-accent text-black" : "bg-cardHover text-muted hover:text-text")
          }
        >
          {follow ? "Following" : "Free scroll"}
        </button>
      </header>

      <ModelStatus status={modelStatus} onRetry={ensureModelLoaded} />

      <TextPane
        chapters={loaded.content.chapters}
        activeChapterIdx={chapterIdx}
        activeSentenceIdx={sentenceIdx}
        onSeekTo={onSeekTextSentence}
        follow={follow}
        onUserScroll={() => {
          lastUserScrollRef.current = Date.now();
          if (follow) setFollow(false);
        }}
      />

      <PlayerBar
        playing={engineState.playing}
        rate={engineState.rate}
        positionSec={engineState.positionSec}
        durationSec={engineState.durationSec}
        chapterTitle={loaded.content.chapters[chapterIdx]?.title ?? ""}
        chapterPositionSec={chapterPos}
        chapterDurationSec={chapterDur}
        generating={engineState.generating}
        onPlayPause={togglePlay}
        onBack15={() => engineRef.current?.skipBySeconds(-15)}
        onFwd15={() => engineRef.current?.skipBySeconds(+15)}
        onPrevSentence={() => engineRef.current?.prevSentence()}
        onNextSentence={() => engineRef.current?.nextSentence()}
        onPrevChapter={() => engineRef.current?.prevChapter()}
        onNextChapter={() => engineRef.current?.nextChapter()}
        onSeekWithinSentence={(s) => engineRef.current?.seekWithinSentence(s)}
        onChangeRate={onChangeRate}
        onOpenToc={() => setTocOpen(true)}
        onSleep={onSleep}
        sleepRemainingMs={sleepRemainingMs}
      />

      <SectionNav
        open={tocOpen}
        chapters={loaded.content.chapters}
        chapterDurationsSec={loaded.estChapterDurSec}
        activeChapterIdx={chapterIdx}
        onClose={() => setTocOpen(false)}
        onSelect={async (i) => {
          setTocOpen(false);
          const sr = loaded.flat.find((s) => s.chapterIdx === i && s.sentenceIdx === 0);
          if (sr) {
            const ok = await ensureModelLoaded();
            if (ok) await engineRef.current?.seekToSentence(sr.globalIdx, true);
          }
        }}
      />
    </div>
  );
}

/* ------------------------- helpers ------------------------- */

function flattenSentences(chapters: ChapterPayload[]): SentenceRef[] {
  const out: SentenceRef[] = [];
  let g = 0;
  chapters.forEach((c, ci) => {
    c.sentences.forEach((s, si) => {
      out.push({
        globalIdx: g++,
        chapterId: c.id,
        chapterIdx: ci,
        sentenceIdx: si,
        text: s
      });
    });
  });
  return out;
}

function cumStartSec(durations: number[]): number[] {
  const out = new Array(durations.length).fill(0);
  let acc = 0;
  for (let i = 0; i < durations.length; i++) {
    out[i] = acc;
    acc += durations[i];
  }
  return out;
}

function chapterPosSec(
  loaded: LoadedBook,
  chapterIdx: number,
  sentenceIdx: number,
  positionInSentenceSec: number
): number {
  const chapter = loaded.content.chapters[chapterIdx];
  if (!chapter) return 0;
  let s = 0;
  for (let i = 0; i < sentenceIdx; i++) {
    const t = chapter.sentences[i] ?? "";
    s += Math.max(0.4, t.length / ESTIMATED_CHARS_PER_SECOND);
  }
  return s + positionInSentenceSec;
}

function sumEstimated(loaded: LoadedBook): number {
  return loaded.estChapterDurSec.reduce((a, b) => a + b, 0);
}

function computeTotalPos(loaded: LoadedBook, s: EngineState): number {
  if (!s.current) return 0;
  const ch = loaded.estChapterStartSec[s.current.chapterIdx] ?? 0;
  return ch + chapterPosSec(loaded, s.current.chapterIdx, s.current.sentenceIdx, s.positionSec);
}

/* ------------------------- subviews ------------------------- */

function FullScreenLoading({ message }: { message: string }) {
  return (
    <div className="h-screen grid place-items-center">
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}

function ModelStatus({
  status, onRetry
}: {
  status:
    | { phase: "idle" }
    | { phase: "loading"; progress: number; file?: string }
    | { phase: "ready" }
    | { phase: "error"; message: string };
  onRetry: () => void;
}) {
  if (status.phase === "idle" || status.phase === "ready") return null;
  if (status.phase === "error") {
    return (
      <div className="mx-4 sm:mx-6 mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        <p>Couldn&rsquo;t load the speech model.</p>
        <p className="mt-1 text-xs text-red-300/90">{status.message}</p>
        <button
          onClick={onRetry}
          className="mt-2 inline-flex items-center gap-2 rounded-md bg-red-500/20 hover:bg-red-500/30 px-3 py-1.5 text-xs text-red-100"
        >
          Retry
        </button>
      </div>
    );
  }
  const pct = Math.round(status.progress * 100);
  return (
    <div className="mx-4 sm:mx-6 mt-2 rounded-md bg-card px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-text">Setting up your reader (one-time, ~80MB)</span>
        <span className="text-xs text-muted tabular-nums">{pct}%</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-line overflow-hidden">
        <div
          className="h-full bg-accent transition-[width] duration-200"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-subtle truncate">
        {status.file
          ? status.file
          : "Downloading the voice — please keep the page open. Wi-Fi is much faster than cellular."}
      </p>
    </div>
  );
}
