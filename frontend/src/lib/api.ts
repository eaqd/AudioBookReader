import type {
  BookDetail,
  BookManifest,
  BookSummary,
  ChunkOut,
  JobStatus,
  ProgressDTO
} from "../types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

function url(path: string): string {
  return BASE ? `${BASE}${path}` : path;
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText}: ${text}`);
  }
  return r.json() as Promise<T>;
}

export const api = {
  baseUrl: BASE,
  audioUrl(path: string): string {
    return url(path);
  },

  async listBooks(): Promise<BookSummary[]> {
    return json(await fetch(url("/books")));
  },
  async getBook(id: string): Promise<BookDetail> {
    return json(await fetch(url(`/books/${id}`)));
  },
  async getChunk(bookId: string, chunkId: string): Promise<ChunkOut> {
    return json(await fetch(url(`/books/${bookId}/chunks/${chunkId}`)));
  },
  async getManifest(bookId: string): Promise<BookManifest> {
    return json(await fetch(url(`/books/${bookId}/manifest`)));
  },
  async deleteBook(id: string): Promise<void> {
    const r = await fetch(url(`/books/${id}`), { method: "DELETE" });
    if (!r.ok) throw new Error(`delete failed: ${r.status}`);
  },
  async listVoices(): Promise<string[]> {
    return json(await fetch(url(`/voices`)));
  },

  uploadBook(file: File, voice: string, title?: string): {
    promise: Promise<{ book_id: string; job_id: string }>;
    abort(): void;
  } {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("voice", voice);
    if (title) fd.append("title", title);
    const ctrl = new AbortController();
    const promise = fetch(url("/books/upload"), {
      method: "POST",
      body: fd,
      signal: ctrl.signal
    }).then(json) as Promise<{ book_id: string; job_id: string }>;
    return { promise, abort: () => ctrl.abort() };
  },

  watchJob(
    jobId: string,
    onUpdate: (j: JobStatus) => void,
    onDone: (j: JobStatus) => void,
    onError: (msg: string) => void
  ): () => void {
    const es = new EventSource(url(`/jobs/${jobId}/stream`));
    es.addEventListener("progress", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as JobStatus;
      onUpdate(data);
      if (data.status === "done" || data.status === "failed") {
        es.close();
        if (data.status === "done") onDone(data);
        else onError(data.message ?? "ingest failed");
      }
    });
    es.addEventListener("error", () => {
      es.close();
      onError("stream error");
    });
    return () => es.close();
  },

  async putProgress(bookId: string, body: { chunk_id: string; offset_ms: number; word_idx: number }):
    Promise<ProgressDTO> {
    return json(await fetch(url(`/books/${bookId}/progress`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }));
  },

  async getProgress(bookId: string): Promise<ProgressDTO | null> {
    const r = await fetch(url(`/books/${bookId}/progress`));
    if (r.status === 404) return null;
    return json(r);
  }
};
