"use client";

import { useState } from "react";
import { extract, ScannedPdfError } from "@/lib/pdf/extract";
import { buildChapters, type BookContent } from "@/lib/pdf/sectioning";

type State =
  | { phase: "idle" }
  | { phase: "parsing"; fileName: string }
  | { phase: "done"; result: BookContent; fileName: string }
  | { phase: "error"; message: string };

export function PdfUploader() {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setState({ phase: "error", message: "Please pick a .pdf file." });
      return;
    }
    setState({ phase: "parsing", fileName: file.name });
    try {
      const doc = await extract(file);
      const result = buildChapters(doc);
      setState({ phase: "done", result, fileName: file.name });
      // eslint-disable-next-line no-console
      console.log("[PdfUploader] extracted book:", result);
      // eslint-disable-next-line no-console
      console.log("[PdfUploader] JSON:", JSON.stringify(result, null, 2));
    } catch (e) {
      const message =
        e instanceof ScannedPdfError
          ? e.message
          : e instanceof Error
            ? `Couldn't read the PDF: ${e.message}`
            : "Couldn't read the PDF.";
      setState({ phase: "error", message });
    }
  }

  return (
    <div className="space-y-6">
      <DropZone
        dragOver={dragOver}
        setDragOver={setDragOver}
        onFile={handleFile}
        busy={state.phase === "parsing"}
      />
      {state.phase === "parsing" && <ParsingRow fileName={state.fileName} />}
      {state.phase === "done" && <DoneCard result={state.result} fileName={state.fileName} />}
      {state.phase === "error" && <ErrorRow message={state.message} />}
    </div>
  );
}

function DropZone({
  dragOver, setDragOver, onFile, busy
}: {
  dragOver: boolean;
  setDragOver: (b: boolean) => void;
  onFile: (f: File) => void;
  busy: boolean;
}) {
  return (
    <label
      htmlFor="pdf-input"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      aria-disabled={busy}
      className={
        "upload-card block cursor-pointer rounded-2xl px-6 py-10 transition shadow-card " +
        (dragOver ? "is-drag" : "") +
        (busy ? " pointer-events-none opacity-70" : "")
      }
    >
      <div className="flex items-center gap-5">
        <div className="h-16 w-16 shrink-0 rounded-xl grid place-items-center bg-accent text-black">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold">Drop a PDF, or tap to choose</p>
          <p className="text-sm text-muted mt-0.5">
            Text-based PDFs only. Scanned books aren&rsquo;t supported in v1.
          </p>
        </div>
      </div>
      <input
        id="pdf-input"
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

function ParsingRow({ fileName }: { fileName: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card text-sm">
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-40 animate-ping" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-accent" />
      </span>
      <span className="truncate">
        <span className="text-muted">Parsing</span>{" "}
        <span className="font-medium">{fileName}</span>…
      </span>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      {message}
    </div>
  );
}

/* ----------------------------- result card ----------------------------- */

function DoneCard({ result, fileName }: { result: BookContent; fileName: string }) {
  const totalSentences = result.chapters.reduce((s, c) => s + c.sentences.length, 0);

  return (
    <article className="rounded-2xl bg-card shadow-card overflow-hidden">
      <header className="flex gap-4 sm:gap-5 p-4 sm:p-6">
        <CoverArt title={result.title} />
        <div className="min-w-0 flex flex-col justify-end">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted">Audiobook</p>
          <h3 className="mt-1 text-xl sm:text-2xl font-bold tracking-tight line-clamp-2">
            {result.title}
          </h3>
          <p className="mt-2 text-xs text-muted truncate">
            <span className="font-mono">{fileName}</span>
          </p>
          <Meta
            chapters={result.chapters.length}
            sentences={totalSentences}
            pages={result.pageCount}
            mode={result.detectionMode}
          />
        </div>
      </header>

      <div className="px-4 sm:px-6 pb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-muted">Chapters</h4>
        <span className="text-[11px] text-subtle">
          full JSON in browser console
        </span>
      </div>

      <ol className="px-2 sm:px-4 pb-4">
        {result.chapters.slice(0, 12).map((c, i) => (
          <ChapterRow
            key={c.id}
            num={i + 1}
            title={c.title}
            page={c.startPage}
            sentences={c.sentences.length}
          />
        ))}
        {result.chapters.length > 12 && (
          <li className="text-xs text-subtle py-3 px-3">
            … and {result.chapters.length - 12} more
          </li>
        )}
      </ol>
    </article>
  );
}

function CoverArt({ title }: { title: string }) {
  // hash → hue so each book gets a unique gradient cover
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  const initial = (title.trim()[0] ?? "?").toUpperCase();
  return (
    <div
      className="h-24 w-24 sm:h-28 sm:w-28 shrink-0 rounded-xl grid place-items-center text-3xl font-black shadow-card"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 35%) 0%, hsl(${(hue + 50) % 360} 80% 18%) 100%)`,
        color: "rgba(255,255,255,0.92)"
      }}
      aria-hidden
    >
      {initial}
    </div>
  );
}

function Meta({
  chapters, sentences, pages, mode
}: { chapters: number; sentences: number; pages: number; mode: string }) {
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <li>{chapters.toLocaleString()} chapters</li>
      <Dot />
      <li>{sentences.toLocaleString()} sentences</li>
      <Dot />
      <li>{pages.toLocaleString()} pages</li>
      <Dot />
      <li>
        <span className="text-subtle mr-1">mode</span>
        <span className="text-text">{mode}</span>
      </li>
    </ul>
  );
}

function Dot() {
  return <span aria-hidden className="text-subtle/70">•</span>;
}

function ChapterRow({
  num, title, page, sentences
}: { num: number; title: string; page: number; sentences: number }) {
  return (
    <li className="group flex items-center gap-3 sm:gap-4 px-3 py-2.5 rounded-md hover:bg-cardHover transition">
      <span className="w-6 text-right text-sm tabular-nums text-muted group-hover:text-text">
        {num}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-[11px] text-subtle">
          p.{page} · {sentences} sentences
        </p>
      </div>
      <span className="opacity-0 group-hover:opacity-100 transition text-muted text-xs">
        {/* placeholder for the future "play this chapter" affordance */}
        ▶
      </span>
    </li>
  );
}
