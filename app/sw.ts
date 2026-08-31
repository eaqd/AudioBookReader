/// <reference lib="webworker" />
/// <reference types="@serwist/next/typings" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  Serwist,
  CacheFirst,
  CacheableResponsePlugin,
  ExpirationPlugin
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Don't aggressively swap an updated SW into active tabs — the user is
  // likely mid-listen and a hot-swap can interrupt audio + lose state.
  // The new SW will activate on next full reload, which is the right
  // behavior for a stateful audiobook reader.
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: true,
  runtimeCaching: [
    // Speech now comes from the device, so there is no model or CDN
    // bundle left to cache. Only the pdf.js worker is worth holding.
    // pdfjs worker: large + immutable.
    {
      matcher: ({ url }) => url.pathname === "/pdf.worker.min.mjs",
      handler: new CacheFirst({
        cacheName: "pdfjs-worker-v1",
        plugins: [new CacheableResponsePlugin({ statuses: [200] })]
      })
    },
    // App shell + assets — let Serwist's defaults handle everything else.
    ...defaultCache
  ],
  fallbacks: {
    entries: [
      {
        url: "/",
        matcher: ({ request }) => request.destination === "document"
      }
    ]
  }
});

// Allow the page to ask us to wipe everything (Reset button).
self.addEventListener("message", (event) => {
  const data = event.data as { type?: string } | undefined;
  if (data?.type === "WIPE_CACHES") {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        const clients = await self.clients.matchAll({ type: "window" });
        for (const c of clients) c.postMessage({ type: "WIPED" });
      })()
    );
  }
});

serwist.addEventListeners();

