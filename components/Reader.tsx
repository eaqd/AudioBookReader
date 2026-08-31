"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextPane, charIndexOfWord } from "./TextPane";
import { ScreenLock } from "./ScreenLock";
import { PlayerBar } from "./PlayerBar";
import { SectionNav } from "./SectionNav";
import { CoverArt } from "./CoverArt";
import { PlayerEngine, type EngineState, type SentenceRef } from "@/lib/player/engine";
import {
  bindMediaSession,
  setMediaPlaybackState,
  setMediaPositionState
} from "@/lib/player/mediaSession";
import { listVoices, speechSupported, type DeviceVoice } from "@/lib/tts/speech";
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
  const [voices, setVoices] = useState<DeviceVoice[]>([]);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  const [sleepRemainingMs, setSleepRemainingMs] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [fontScale, setFontScale] = useState(1.05);
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
      voice: (() => {
        try {
          return localStorage.getItem("abr.voice");
        } catch {
          return null;
        }
      })()
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
          offsetSec: s.positionSec,
          charIndex: s.charIndex
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
      // Prefer the exact character we stopped on; fall back to the older
      // seconds-based field for rows written before charIndex existed.
      if (typeof p?.charIndex === "number" && p.charIndex > 0) {
        await eng.seekToSentenceChar(idx, p.charIndex, false);
      } else if (p?.offsetSec) {
        eng.seekWithinSentence(p.offsetSec);
      }
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

  // Device voice list (async on most browsers).
  useEffect(() => {
    let alive = true;
    void listVoices().then((v) => {
      if (alive) setVoices(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* -------- callbacks -------- */

  // Device speech needs no download; just confirm the API exists.
  const ensureModelLoaded = useCallback(async () => {
    if (!speechSupported()) {
      setSpeechError("This browser has no speech synthesis. Try Safari or Chrome.");
      return false;
    }
    setSpeechError(null);
    return true;
  }, []);

  const togglePlay = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng) return;
    // Synchronously unlock iOS audio inside the click. Must run before any
    // await — once the gesture expires, .play() will be blocked.
    eng.prime();
    if (eng.isPlaying()) {
      eng.pause();
      return;
    }
    const ok = await ensureModelLoaded();
    if (!ok) return;
    try {
      await eng.play();
    } catch (e) {
      setSpeechError((e as Error).message);
    }
  }, [ensureModelLoaded]);

  const onSeekTextSentence = useCallback(
    async (chapterIdx: number, sentenceIdx: number, wordIdx?: number) => {
      if (!loaded || !engineRef.current) return;
      // Same iOS-unlock dance as togglePlay.
      engineRef.current.prime();
      const ok = await ensureModelLoaded();
      if (!ok) return;
      const target = loaded.flat.find(
        (s) => s.chapterIdx === chapterIdx && s.sentenceIdx === sentenceIdx
      );
      if (!target) return;
      if (typeof wordIdx === "number" && wordIdx > 0) {
        const ci = charIndexOfWord(target.text, wordIdx);
        await engineRef.current.seekToSentenceChar(target.globalIdx, ci, true);
      } else {
        await engineRef.current.seekToSentence(target.globalIdx, true);
      }
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
          onClick={() => setFontScale((f) => (f >= 1.35 ? 0.9 : +(f + 0.15).toFixed(2)))}
          aria-label="Text size"
          className="shrink-0 text-xs px-2 py-1 rounded-md bg-cardHover text-muted hover:text-text"
        >
          A{fontScale >= 1.2 ? "+" : fontScale <= 0.95 ? "-" : ""}
        </button>
        <button
          onClick={() => setLocked(true)}
          aria-label="Lock screen"
          className="shrink-0 text-xs px-2 py-1 rounded-md bg-cardHover text-muted hover:text-text"
        >
          Lock
        </button>
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

      {speechError && (
        <div className="mx-4 sm:mx-6 mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {speechError}
        </div>
      )}

      <TextPane
        chapters={loaded.content.chapters}
        activeChapterIdx={chapterIdx}
        activeSentenceIdx={sentenceIdx}
        activeWordIdx={engineState.wordIdx}
        onSeekTo={onSeekTextSentence}
        follow={follow}
        fontScale={fontScale}
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
        voices={voices}
        voiceId={engineState ? engineRef.current?.getVoice() ?? null : null}
        onChangeVoice={(id) => {
          engineRef.current?.setVoice(id);
          try {
            localStorage.setItem("abr.voice", id);
          } catch {
            /* private mode */
          }
        }}
        synthProgress={engineState.synthProgress}
        lastError={engineState.lastError}
        onClearError={() => engineRef.current?.clearError()}
      />

      {locked && (
        <ScreenLock
          bookTitle={loaded.book.title}
          chapterTitle={loaded.content.chapters[chapterIdx]?.title ?? ""}
          playing={engineState.playing}
          onUnlock={() => setLocked(false)}
          onTogglePlay={togglePlay}
        />
      )}

      <SectionNav
        open={tocOpen}
        chapters={loaded.content.chapters}
        chapterDurationsSec={loaded.estChapterDurSec}
        activeChapterIdx={chapterIdx}
        onClose={() => setTocOpen(false)}
        onSelect={async (i) => {
          // Prime synchronously before closing drawer / awaiting model.
          engineRef.current?.prime();
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

