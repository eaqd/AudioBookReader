import { getDB, type ProgressRow } from "./db";

export async function loadProgress(bookId: string): Promise<ProgressRow | null> {
  const db = await getDB();
  return (await db.get("progress", bookId)) ?? null;
}

export async function saveProgress(p: Omit<ProgressRow, "updatedAt">): Promise<void> {
  const db = await getDB();
  await db.put("progress", { ...p, updatedAt: Date.now() });
}

let pending: Omit<ProgressRow, "updatedAt"> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Save progress at most every `delayMs` ms; coalesces rapid updates while
 * audio plays. Always queues the *latest* values.
 */
export function saveProgressDebounced(
  p: Omit<ProgressRow, "updatedAt">,
  delayMs = 3000
): void {
  pending = p;
  if (timer != null) return;
  timer = setTimeout(async () => {
    timer = null;
    const cur = pending;
    pending = null;
    if (cur) await saveProgress(cur);
  }, delayMs);
}

/** Force-flush any pending debounced progress write (call on unmount). */
export async function flushProgressNow(): Promise<void> {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  const cur = pending;
  pending = null;
  if (cur) await saveProgress(cur);
}
