"use client";

import { fmtMins } from "@/lib/util/format";
import type { ChapterPayload } from "@/lib/storage/db";

interface Props {
  open: boolean;
  chapters: ChapterPayload[];
  /** Estimated duration per chapter in seconds (same length as chapters). */
  chapterDurationsSec: number[];
  activeChapterIdx: number;
  onClose: () => void;
  onSelect: (chapterIdx: number) => void;
}

export function SectionNav({
  open, chapters, chapterDurationsSec, activeChapterIdx, onClose, onSelect
}: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 flex">
      <div onClick={onClose} aria-hidden className="flex-1 bg-black/60" />
      <aside className="w-[85%] max-w-md bg-surface h-full overflow-y-auto safe-top safe-bottom shadow-card">
        <div className="px-5 pt-6 pb-3 flex items-center justify-between sticky top-0 bg-surface/95 backdrop-blur">
          <h2 className="text-lg font-bold tracking-tight">Chapters</h2>
          <button onClick={onClose} className="text-sm text-muted hover:text-text">
            Close
          </button>
        </div>
        <ul className="px-2 pb-6">
          {chapters.map((c, i) => (
            <li key={c.id}>
              <button
                onClick={() => onSelect(i)}
                className={
                  "w-full text-left px-4 py-3 rounded-md flex items-start gap-3 transition " +
                  (i === activeChapterIdx
                    ? "bg-cardHover text-accent"
                    : "hover:bg-cardHover text-text")
                }
              >
                <span className="w-6 text-right text-sm tabular-nums text-muted">
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium leading-tight">
                    {c.title}
                  </span>
                  <span className="block text-[11px] text-subtle mt-0.5">
                    p.{c.startPage} · {c.sentences.length} sentences ·{" "}
                    {fmtMins(chapterDurationsSec[i] ?? 0)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
