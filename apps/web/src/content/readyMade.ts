import decks from 'virtual:ready-made-decks';
import type { PrebuiltDeck } from '@recall/core';
import { orderForWelcome } from '../services/readyMade';

/**
 * Ready-made decks bundled with the app (brief §11): every `content/decks/*.json`,
 * validated at build time by `build/readyMadeDecks.ts` and compiled into the bundle, so
 * they are precached by the service worker and available offline.
 */
export const READY_MADE_DECKS: readonly PrebuiltDeck[] = decks;

/** The first-visit screen offers every bundled deck, in this order (DECISIONS D-318). */
export const WELCOME_ORDER = ['robbins-ch3-inflammation-repair-v1', 'dbms-basics-v1'] as const;

export const WELCOME_DECKS: readonly PrebuiltDeck[] = orderForWelcome(
  READY_MADE_DECKS,
  WELCOME_ORDER,
);
