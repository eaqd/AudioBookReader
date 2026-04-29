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
      // Step 1 deliverable: dump the structured book to the console.
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
    <div className="w-full max-w-xl mx-auto">
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
          if (f) void handleFile(f);
        }}
        className={
          "block cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition " +
          (dragOver ? "border-indigo-500 bg-indigo-500/5" : "border-current/20 hover:border-current/40")
        }
      >
        <p className="text-base font-medium">Drop a PDF here, or click to pick</p>
        <p className="mt-1 text-xs opacity-60">
          Step 1: text extraction + section detection. Open DevTools → Console to see the parsed book.
        </p>
        <input
          id="pdf-input"
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </label>

      <div className="mt-6 min-h-[3rem]">
        {state.phase === "parsing" && <ParsingRow fileName={state.fileName} />}
        {state.phase === "done" && <DoneRow result={state.result} fileName={state.fileName} />}
        {state.phase === "error" && <ErrorRow message={state.message} />}
      </div>
    </div>
  );
}

function ParsingRow({ fileName }: { fileName: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-indigo-500" />
      <span className="opacity-80">Parsing {fileName}…</span>
    </div>
  );
}

function DoneRow({ result, fileName }: { result: BookContent; fileName: string }) {
  const totalSentences = result.chapters.reduce((s, c) => s + c.sentences.length, 0);
  return (
    <div className="rounded-xl border border-current/15 p-4 text-sm">
      <p className="font-medium">
        Got <span className="tabular-nums">{result.chapters.length}</span> chapter
        {result.chapters.length === 1 ? "" : "s"} and{" "}
        <span className="tabular-nums">{totalSentences.toLocaleString()}</span> sentences
        from <span className="font-mono opacity-80">{fileName}</span>.
      </p>
      <p className="mt-1 text-xs opacity-60">
        Detection mode: <code>{result.detectionMode}</code>. Pages: {result.pageCount}.
      </p>
      <ul className="mt-3 max-h-48 overflow-auto text-xs opacity-80">
        {result.chapters.slice(0, 12).map((c) => (
          <li key={c.id} className="truncate">
            <span className="opacity-60 mr-2">p.{c.startPage}</span>
            {c.title}
            <span className="opacity-50"> — {c.sentences.length} sentences</span>
          </li>
        ))}
        {result.chapters.length > 12 && (
          <li className="opacity-50">…and {result.chapters.length - 12} more.</li>
        )}
      </ul>
      <p className="mt-3 text-xs opacity-60">
        Full JSON dumped to the browser console.
      </p>
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
      {message}
    </div>
  );
}
