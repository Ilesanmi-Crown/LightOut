import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // New versions download in the background and apply on the next load;
      // src/lib/swUpdate.js shows a "refresh" toast instead of reloading.
      registerType: "autoUpdate",
      injectRegister: false, // registered from src/main.jsx via virtual:pwa-register
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Lightout",
        short_name: "Lightout",
        description: "Study AI that keeps working when the light and data don't.",
        theme_color: "#0b0f14",
        background_color: "#0b0f14",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the whole app shell: JS (incl. lazy chunks, the file-prep worker and the
        // bundled sample pack, which is part of the JS), CSS, HTML, icons, manifest, Latin fonts.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,json}", "**/*-latin-*.woff2"],
        globIgnores: ["**/*-latin-ext-*.woff2"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // autoUpdate: the new service worker takes over as soon as it's installed. (The plugin only sets
        // these automatically when it injects its own register script; we register manually for the toast.)
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Offline after one online visit: every navigation falls back to the cached index.html.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/__/],
        // Never cache AI / Firebase API calls. Fonts not in the precache (other subsets) are cached on first use.
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.destination === "font" || /\.(woff2?|ttf|otf)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "lightout-fonts",
              expiration: { maxEntries: 40, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Not used today (fonts are self-hosted), but cached if Google Fonts is ever added.
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "lightout-google-fonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
