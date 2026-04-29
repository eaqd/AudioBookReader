import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "apple-touch-icon.png"],
      manifest: {
        name: "Audiobook Reader",
        short_name: "Audiobook",
        description: "Listen to any PDF as a synchronized audiobook.",
        start_url: "/",
        display: "standalone",
        background_color: "#0b0b10",
        theme_color: "#0b0b10",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        runtimeCaching: [
          {
            // App-shell cached above. Audio chunks: cache-first, 30 days.
            urlPattern: ({ url }) => url.pathname.startsWith("/audio/"),
            handler: "CacheFirst",
            options: {
              cacheName: "audio-v1",
              rangeRequests: true,
              expiration: { maxEntries: 5000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200, 206] }
            }
          },
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/books") || url.pathname.startsWith("/covers"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "api-v1" }
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      "/books": "http://localhost:8000",
      "/audio": "http://localhost:8000",
      "/jobs": "http://localhost:8000",
      "/voices": "http://localhost:8000",
      "/covers": "http://localhost:8000",
      "/health": "http://localhost:8000"
    }
  }
});
