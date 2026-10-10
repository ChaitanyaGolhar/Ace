import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readyMadeDecksPlugin } from './build/readyMadeDecks';

export default defineConfig({
  plugins: [
    readyMadeDecksPlugin(),
    react(),
    tailwindcss(),
    VitePWA({
      // Never reload on our own: a new version shows the "Update available" banner
      // and only reloads when the user taps it (§7.3).
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Recall',
        short_name: 'Recall',
        description: 'Spaced-repetition flashcards that work offline.',
        theme_color: '#111315',
        background_color: '#111315',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the whole app shell, including the self-hosted fonts (the app must
        // look right offline). Prebuilt decks are bundled into the JS.
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}'],
        // Any in-app URL loads the shell offline; the router takes it from there.
        navigateFallback: '/index.html',
        // No runtime caching at all: API responses are never cached (§7.3).
        runtimeCaching: [],
      },
    }),
  ],
  preview: { port: 4173, strictPort: true },
  server: { port: 5173, strictPort: true },
  define: {
    // Shown in Settings ("Recall 0.1 · Scheduling by FSRS").
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
});
