"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import type { ChapterPayload } from "@/lib/storage/db";

export interface TextPaneProps {
  chapters: ChapterPayload[];
  activeChapterIdx: number;
  activeSentenceIdx: number;
  /** Word being spoken inside the active sentence, or -1. */
  activeWordIdx: number;
  /** Seek to a sentence, optionally to a word inside it. */
  onSeekTo: (chapterIdx: number, sentenceIdx: number, wordIdx?: number) => void;
  follow: boolean;
  onUserScroll: () => void;
  /** 0.85 - 1.5, user text-size preference. */
  fontScale: number;
}

/**
 * Only the active chapter is rendered.
 *
 * A full book is far too much DOM: the 482-page book under test produced
 * 6,618 sentences, and rendering every one (plus per-word spans) makes
 * scrolling and highlighting stutter badly on a phone. A chapter is a
 * natural reading unit and keeps the tree to a few hundred nodes.
 *
 * Per-word spans exist only inside the sentence currently being spoken —
 * that is the only place word-level highlighting is visible, and it keeps
 * the cost proportional to one sentence rather than the whole chapter.
 */
export const TextPane = memo(function TextPane({
  chapters,
  activeChapterIdx,
  activeSentenceIdx,
  activeWordIdx,
  onSeekTo,
  follow,
  onUserScroll,
  fontScale
}: TextPaneProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const programmatic = useRef(false);

  const chapter = chapters[activeChapterIdx];

  // Keep the spoken word centred while following.
  useEffect(() => {
    if (!follow) return;
    const root = scrollRef.current;
    if (!root) return;
    const word = root.querySelector(`[data-widx="${activeWordIdx}"]`) as HTMLElement | null;
    const sentence = root.querySelector(
      `[data-sidx="${activeSentenceIdx}"]`
    ) as HTMLElement | null;
    const target = word ?? sentence;
    if (!target) return;
    programmatic.current = true;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = window.setTimeout(() => {
      programmatic.current = false;
    }, 600);
    return () => window.clearTimeout(t);
  }, [follow, activeSentenceIdx, activeWordIdx, activeChapterIdx]);

  // Manual scroll breaks follow mode.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (programmatic.current) return;
      onUserScroll();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onUserScroll]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement;
    const wordEl = el.closest("[data-widx]") as HTMLElement | null;
    const sentEl = el.closest("[data-sidx]") as HTMLElement | null;
    if (!sentEl) return;
    const sidx = Number.parseInt(sentEl.dataset.sidx ?? "", 10);
    if (!Number.isFinite(sidx)) return;
    const widx = wordEl ? Number.parseInt(wordEl.dataset.widx ?? "", 10) : undefined;
    onSeekTo(activeChapterIdx, sidx, Number.isFinite(widx as number) ? widx : undefined);
  }

  if (!chapter) {
    return <div className="flex-1 grid place-items-center text-muted text-sm">No chapter</div>;
  }

  return (
    <div
      ref={scrollRef}
      onClick={handleClick}
      className="flex-1 overflow-y-auto no-scrollbar px-5 sm:px-8"
    >
      <div className="max-w-[38rem] mx-auto py-6">
        <header className="mb-6">
          <p className="text-[10px] uppercase tracking-[0.2em] text-subtle">
            Chapter {activeChapterIdx + 1} of {chapters.length}
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight leading-snug">
            {chapter.title}
          </h2>
          <p className="mt-1 text-xs text-muted">
            page {chapter.startPage} &middot; {chapter.sentences.length} sentences
          </p>
        </header>

        <div
          className="reader-body text-text/90"
          style={{ fontSize: `${fontScale}rem` }}
        >
          {chapter.sentences.map((s, i) => (
            <Sentence
              key={i}
              text={s}
              sidx={i}
              isActive={i === activeSentenceIdx}
              activeWordIdx={activeWordIdx}
            />
          ))}
        </div>

        <div className="h-40" />
      </div>
    </div>
  );
});

const Sentence = memo(function Sentence({
  text,
  sidx,
  isActive,
  activeWordIdx
}: {
  text: string;
  sidx: number;
  isActive: boolean;
  activeWordIdx: number;
}) {
  // Inactive sentences stay a single node — cheap, and nothing inside
  // them needs individual addressing.
  if (!isActive) {
    return (
      <span
        data-sidx={sidx}
        className="sentence cursor-pointer rounded px-0.5 hover:bg-white/5"
      >
        {text}{" "}
      </span>
    );
  }
  return (
    <span data-sidx={sidx} className="sentence sentence-active rounded px-0.5">
      <Words text={text} activeWordIdx={activeWordIdx} />{" "}
    </span>
  );
});

const Words = memo(function Words({
  text,
  activeWordIdx
}: {
  text: string;
  activeWordIdx: number;
}) {
  const parts = useMemo(() => splitKeepingGaps(text), [text]);
  let wordCounter = -1;
  return (
    <>
      {parts.map((p, i) => {
        if (!p.isWord) return <span key={i}>{p.text}</span>;
        wordCounter += 1;
        const idx = wordCounter;
        return (
          <span
            key={i}
            data-widx={idx}
            className={"word" + (idx === activeWordIdx ? " word-active" : "")}
          >
            {p.text}
          </span>
        );
      })}
    </>
  );
});

/** Split into words and the whitespace between them, preserving both. */
function splitKeepingGaps(text: string): { text: string; isWord: boolean }[] {
  const out: { text: string; isWord: boolean }[] = [];
  const re = /\S+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), isWord: false });
    out.push({ text: m[0], isWord: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), isWord: false });
  return out;
}

/** Character offset where a given word starts — for tap-to-seek. */
export function charIndexOfWord(text: string, wordIdx: number): number {
  const re = /\S+/g;
  let i = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    i += 1;
    if (i === wordIdx) return m.index;
  }
  return 0;
}
