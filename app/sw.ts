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
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Hugging Face: Kokoro model files. Big, immutable — perfect for
    // CacheFirst. Only cache complete 200 responses; iOS sometimes aborts
    // a fetch mid-stream and we don't want a partial body sitting around.
    {
      matcher: ({ url }) =>
        url.host.includes("huggingface.co") || url.host.includes("hf.co"),
      handler: new CacheFirst({
        cacheName: "kokoro-model-v1",
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({
            maxEntries: 200,
            maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
          })
        ]
      })
    },
    // jsDelivr / esm.sh ESM bundles (kokoro-js, transformers.js,
    // onnxruntime-web). Same partial-response concern.
    {
      matcher: ({ url }) =>
        url.host.includes("cdn.jsdelivr.net") || url.host.includes("esm.sh"),
      handler: new CacheFirst({
        cacheName: "esm-cdn-v1",
        plugins: [
          new CacheableResponsePlugin({ statuses: [200] }),
          new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })
        ]
      })
    },
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

