import { api } from "./api";

const AUDIO_CACHE = "audio-v1";

export async function downloadBookForOffline(
  bookId: string,
  onProgress: (done: number, total: number) => void
): Promise<void> {
  if (!("caches" in window)) {
    throw new Error("Cache Storage API unavailable in this browser.");
  }
  const manifest = await api.getManifest(bookId);
  const cache = await caches.open(AUDIO_CACHE);
  let done = 0;
  for (const ch of manifest.chunks) {
    const u = api.audioUrl(ch.audio_url);
    const existing = await cache.match(u);
    if (!existing) {
      try {
        await cache.add(u);
      } catch (e) {
        console.warn("cache add failed", u, e);
      }
    }
    done += 1;
    onProgress(done, manifest.chunks.length);
  }
}

export async function isBookCached(bookId: string): Promise<boolean> {
  if (!("caches" in window)) return false;
  const cache = await caches.open(AUDIO_CACHE);
  const keys = await cache.keys();
  return keys.some((req) => req.url.includes(`/audio/${bookId}/`));
}

export async function evictBook(bookId: string): Promise<void> {
  if (!("caches" in window)) return;
  const cache = await caches.open(AUDIO_CACHE);
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((req) => req.url.includes(`/audio/${bookId}/`))
      .map((req) => cache.delete(req))
  );
}

export async function estimateQuota(): Promise<{ usage: number; quota: number } | null> {
  if (!("storage" in navigator) || !navigator.storage.estimate) return null;
  const r = await navigator.storage.estimate();
  return { usage: r.usage ?? 0, quota: r.quota ?? 0 };
}
