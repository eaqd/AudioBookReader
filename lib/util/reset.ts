/**
 * Nuke everything: IndexedDB stores, all SW caches, then hard-reload.
 * Useful when the app is wedged after a half-broken model load on iOS.
 */
export async function resetEverything(): Promise<void> {
  // Tell the SW to wipe its caches first; it'll postMessage WIPED back.
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
    reg?.active?.postMessage({ type: "WIPE_CACHES" });
  }
  // Best-effort cache wipe in the page context too (older browsers, no SW).
  if (typeof caches !== "undefined") {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      /* ignore */
    }
  }
  // Drop our IndexedDB databases.
  if (typeof indexedDB !== "undefined") {
    const names = ["audiobookreader"];
    // transformers.js stores a separate cache database too.
    try {
      // some browsers expose databases() — grab those names too.
      const list = (indexedDB as unknown as {
        databases?: () => Promise<{ name?: string }[]>;
      }).databases;
      if (typeof list === "function") {
        const all = await list.call(indexedDB);
        for (const r of all) if (r.name && !names.includes(r.name)) names.push(r.name);
      }
    } catch {
      /* ignore */
    }
    await Promise.all(
      names.map(
        (n) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(n);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          })
      )
    );
  }
  // Unregister the SW so the next load is fresh.
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
  }
  // Reload, bypassing the bfcache.
  if (typeof window !== "undefined") {
    window.location.replace("/");
  }
}
