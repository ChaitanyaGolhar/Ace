import decks from 'virtual:ready-made-decks';
import type { PrebuiltDeck } from '@recall/core';

/**
 * Ready-made decks bundled with the app (brief §11): every `content/decks/*.json`,
 * validated at build time by `build/readyMadeDecks.ts` and compiled into the bundle, so
 * they are precached by the service worker and available offline.
 */
export const READY_MADE_DECKS: readonly PrebuiltDeck[] = decks;
