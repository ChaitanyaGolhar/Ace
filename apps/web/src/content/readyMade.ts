import type { ReadyMadeDeck } from '../services/readyMade';

/**
 * Ready-made decks bundled with the app (brief §11).
 *
 * Empty on purpose: the deck content (`content/decks/*.json`, validated at build time)
 * belongs to milestone M3, which hasn't been built. The welcome screen, the Browse
 * screen and "Add a ready-made deck" all read this list and hide their ready-made parts
 * while it is empty. See UI_REPORT.md › "Data that doesn't exist yet".
 */
export const READY_MADE_DECKS: readonly ReadyMadeDeck[] = [];
