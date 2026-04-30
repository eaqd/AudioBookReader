/// <reference lib="webworker" />
/// <reference types="@serwist/next/typings" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, CacheFirst, ExpirationPlugin } from "serwist";

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
    // Hugging Face: Kokoro model files. Big, immutable — perfect for CacheFirst.
    {
      matcher: ({ url }) =>
        url.host.includes("huggingface.co") || url.host.includes("hf.co"),
      handler: new CacheFirst({
        cacheName: "kokoro-model-v1",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 200,
            maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
          })
        ]
      })
    },
    // jsDelivr ESM bundles (kokoro-js, transformers.js, onnxruntime-web).
    {
      matcher: ({ url }) =>
        url.host.includes("cdn.jsdelivr.net") || url.host.includes("esm.sh"),
      handler: new CacheFirst({
        cacheName: "esm-cdn-v1",
        plugins: [
          new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })
        ]
      })
    },
    // pdfjs worker: large + immutable.
    {
      matcher: ({ url }) => url.pathname === "/pdf.worker.min.mjs",
      handler: new CacheFirst({ cacheName: "pdfjs-worker-v1" })
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

serwist.addEventListeners();
