import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Never reload on our own: a new version shows the "Update available" banner
      // and only reloads when the user taps it (§7.3).
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'recall',
        short_name: 'recall',
        description: 'Spaced-repetition flashcards that work offline.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
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
        // Precache the whole app shell (prebuilt decks are bundled into the JS).
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        // Any in-app URL loads the shell offline; the router takes it from there.
        navigateFallback: '/index.html',
        // No runtime caching at all: API responses are never cached (§7.3).
        runtimeCaching: [],
      },
    }),
  ],
  preview: { port: 4173, strictPort: true },
  server: { port: 5173, strictPort: true },
});
