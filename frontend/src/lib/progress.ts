import { api } from "./api";
import { db, type LocalProgress } from "./db";
import type { ProgressDTO } from "../types";

export async function loadProgress(bookId: string): Promise<LocalProgress | null> {
  const local = await db.progress.get(bookId);
  let remote: ProgressDTO | null = null;
  try {
    remote = await api.getProgress(bookId);
  } catch {
    /* offline ok */
  }
  if (!local && !remote) return null;
  if (!local && remote) {
    return toLocal(remote);
  }
  if (local && !remote) return local;
  // both exist: take newer
  const localT = local!.updatedAt;
  const remoteT = new Date(remote!.updated_at).getTime();
  return remoteT > localT ? toLocal(remote!) : local!;
}

function toLocal(r: ProgressDTO): LocalProgress {
  return {
    bookId: r.book_id,
    chunkId: r.chunk_id,
    offsetMs: r.offset_ms,
    wordIdx: r.word_idx,
    updatedAt: new Date(r.updated_at).getTime()
  };
}

let pendingTimer: number | null = null;
let pending: LocalProgress | null = null;

export function saveProgressDebounced(p: LocalProgress, delayMs = 3000): void {
  pending = p;
  // Always write locally immediately — fast & offline-safe.
  void db.progress.put({ ...p, updatedAt: Date.now() });
  if (pendingTimer != null) return;
  pendingTimer = window.setTimeout(async () => {
    pendingTimer = null;
    if (!pending) return;
    const cur = pending;
    pending = null;
    try {
      await api.putProgress(cur.bookId, {
        chunk_id: cur.chunkId,
        offset_ms: cur.offsetMs,
        word_idx: cur.wordIdx
      });
    } catch {
      /* network may be offline; we still have local copy */
    }
  }, delayMs);
}

export function flushProgressNow(): Promise<void> {
  if (pendingTimer != null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  const cur = pending;
  pending = null;
  if (!cur) return Promise.resolve();
  return api
    .putProgress(cur.bookId, {
      chunk_id: cur.chunkId,
      offset_ms: cur.offsetMs,
      word_idx: cur.wordIdx
    })
    .then(() => undefined)
    .catch(() => undefined);
}
