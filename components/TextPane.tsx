"use client";

import { memo, useEffect, useRef } from "react";
import type { ChapterPayload } from "@/lib/storage/db";

export interface TextPaneProps {
  chapters: ChapterPayload[];
  /** Pairs (chapterIdx, sentenceIdx) for currently active sentence. */
  activeChapterIdx: number;
  activeSentenceIdx: number;
  onSeekTo: (chapterIdx: number, sentenceIdx: number) => void;
  /** Auto-scroll to the active sentence. */
  follow: boolean;
  onUserScroll: () => void;
}

export const TextPane = memo(function TextPane({
  chapters,
  activeChapterIdx,
  activeSentenceIdx,
  onSeekTo,
  follow,
  onUserScroll
}: TextPaneProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const programmaticScroll = useRef(false);

  // auto-scroll to active sentence when follow is true
  useEffect(() => {
    if (!follow) return;
    const sel = `[data-cidx="${activeChapterIdx}"][data-sidx="${activeSentenceIdx}"]`;
    const el = scrollRef.current?.querySelector(sel) as HTMLElement | null;
    if (el) {
      programmaticScroll.current = true;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      // clear flag after the smooth scroll settles
      window.setTimeout(() => {
        programmaticScroll.current = false;
      }, 500);
    }
  }, [follow, activeChapterIdx, activeSentenceIdx]);

  // detect user-initiated scroll → break follow
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (programmaticScroll.current) return;
      onUserScroll();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onUserScroll]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest("[data-sidx]") as HTMLElement | null;
    if (!target) return;
    const cidx = parseInt(target.dataset.cidx ?? "", 10);
    const sidx = parseInt(target.dataset.sidx ?? "", 10);
    if (Number.isFinite(cidx) && Number.isFinite(sidx)) onSeekTo(cidx, sidx);
  }

  return (
    <div
      ref={scrollRef}
      onClick={handleClick}
      className="flex-1 overflow-y-auto no-scrollbar px-5 sm:px-8 reader-text"
    >
      <div className="max-w-2xl mx-auto py-6 space-y-7">
        {chapters.map((chapter, cidx) => (
          <ChapterBlock
            key={chapter.id}
            chapter={chapter}
            cidx={cidx}
            activeCidx={activeChapterIdx}
            activeSidx={activeSentenceIdx}
          />
        ))}
        <div className="h-32" /> {/* bottom spacer above PlayerBar */}
      </div>
    </div>
  );
});

interface BlockProps {
  chapter: ChapterPayload;
  cidx: number;
  activeCidx: number;
  activeSidx: number;
}

const ChapterBlock = memo(function ChapterBlock({
  chapter, cidx, activeCidx, activeSidx
}: BlockProps) {
  return (
    <section data-chapter={chapter.id}>
      <h2 className="text-xl font-bold tracking-tight mb-2 text-text/90">
        {chapter.title}
      </h2>
      <p className="text-[11px] uppercase tracking-[0.18em] text-subtle mb-4">
        starts on page {chapter.startPage} · {chapter.sentences.length} sentences
      </p>
      <div className="leading-[1.85] text-[1.02rem] text-text/85 space-y-1">
        {chapter.sentences.map((s, i) => {
          const isActive = cidx === activeCidx && i === activeSidx;
          return (
            <span
              key={i}
              data-cidx={cidx}
              data-sidx={i}
              className={
                "inline cursor-pointer rounded px-0.5 transition " +
                (isActive
                  ? "bg-accent/20 shadow-[inset_3px_0_0_0_var(--tw-shadow-color)] shadow-accent"
                  : "hover:bg-white/5")
              }
            >
              {s}{" "}
            </span>
          );
        })}
      </div>
    </section>
  );
});
