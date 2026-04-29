import { memo, type ReactNode } from "react";
import type { ChunkOut, WordTime } from "../types";

interface Props {
  chunk: ChunkOut;
  isCurrentChunk: boolean;
  activeWordIdx: number;
}

/** Renders one chunk's text with per-word spans. Memoized — only re-renders
 *  when the chunk identity, current-flag, or active word changes.
 */
export const ChunkText = memo(function ChunkText({ chunk, isCurrentChunk, activeWordIdx }: Props): JSX.Element {
  return (
    <p
      className="paragraph"
      data-cid={chunk.id}
    >
      {renderWords(chunk.text, chunk.words, isCurrentChunk ? activeWordIdx : -1, chunk.id)}
    </p>
  );
});

function renderWords(
  text: string,
  words: WordTime[],
  activeIdx: number,
  cid: string
): ReactNode[] {
  if (!words.length) {
    return [<span key={`${cid}-raw`}>{text}</span>];
  }
  const out: ReactNode[] = [];
  let cursor = 0;
  words.forEach((w, i) => {
    if (w.cs > cursor) {
      out.push(<span key={`${cid}-gap-${i}`}>{text.slice(cursor, w.cs)}</span>);
    }
    const cls =
      "word" +
      (w.unstable ? " unstable" : "") +
      (i === activeIdx ? " active" : "");
    out.push(
      <span
        key={`${cid}-w-${i}`}
        className={cls}
        data-cid={cid}
        data-w={i}
      >
        {text.slice(w.cs, w.ce)}
      </span>
    );
    cursor = w.ce;
  });
  if (cursor < text.length) {
    out.push(<span key={`${cid}-tail`}>{text.slice(cursor)}</span>);
  }
  return out;
}
