"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { extract, ScannedPdfError } from "@/lib/pdf/extract";
import { buildChapters } from "@/lib/pdf/sectioning";
import { addBook } from "@/lib/storage/books";

type State =
  | { phase: "idle" }
  | { phase: "parsing"; fileName: string }
  | { phase: "saving"; fileName: string }
  | { phase: "error"; message: string };

const DEFAULT_VOICE = "af_bella";

export function PdfUploader() {
  const router = useRouter();
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
      setState({ phase: "saving", fileName: file.name });
      const row = await addBook({
        title: result.title,
        fileName: file.name,
        voice: DEFAULT_VOICE,
        pageCount: result.pageCount,
        detectionMode: result.detectionMode,
        chapters: result.chapters,
        pdfBlob: file
      });
      router.push(`/reader/${row.id}`);
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

  const busy = state.phase === "parsing" || state.phase === "saving";

  return (
    <div className="space-y-4">
      <DropZone
        dragOver={dragOver}
        setDragOver={setDragOver}
        onFile={handleFile}
        busy={busy}
      />
      {state.phase === "parsing" && (
        <BusyRow text={`Parsing ${state.fileName}…`} />
      )}
      {state.phase === "saving" && (
        <BusyRow text={`Saving ${state.fileName} to your library…`} />
      )}
      {state.phase === "error" && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {state.message}
        </div>
      )}
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
        "upload-card block cursor-pointer rounded-2xl px-5 py-7 transition shadow-card " +
        (dragOver ? "is-drag" : "") +
        (busy ? " pointer-events-none opacity-70" : "")
      }
    >
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 shrink-0 rounded-xl grid place-items-center bg-accent text-black">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold">Add a PDF</p>
          <p className="text-sm text-muted mt-0.5">
            Drop a file here or tap to choose.
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

function BusyRow({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card text-sm">
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-40 animate-ping" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-accent" />
      </span>
      <span className="truncate text-muted">{text}</span>
    </div>
  );
}
