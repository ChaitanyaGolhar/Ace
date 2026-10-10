/** Injected by vite.config.ts `define`. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Base URL of the sync/auth API. */
  readonly VITE_API_URL?: string;
}

declare module 'virtual:ready-made-decks' {
  /** content/decks/*.json, validated at build time (build/readyMadeDecks.ts). */
  const decks: import('@recall/core').PrebuiltDeck[];
  export default decks;
}
