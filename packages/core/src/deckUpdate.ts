import type { CardContent } from './content';
import { cardContentOf, type DeckFile } from './deckFile';
import { contentHash } from './hash';

// Deck updates (BUILD_BRIEF_M6_M8 §7.6). Pure: given the student's cards of one catalog
// deck, the version they're on and the latest version, say what to do with each card
// key. The app applies the plan in one Dexie transaction; ids are deterministic
// (`catalogCardId`), so two devices applying the same plan converge.

/** What the plan needs to know about a card in the student's copy. */
export interface LocalCatalogCard {
  id: string;
  sourceKey: string | null;
  /** Hash of the catalog content the card was last set from. */
  sourceHash: string | null;
  content: CardContent;
  unit: number | null;
  deletedAt: number | null;
}

export interface DeckUpdatePlan {
  /** Changed in the catalog and not edited here: new content (same id, so the schedule stays). */
  replace: {
    cardId: string;
    key: string;
    content: CardContent;
    unit: number;
    sourceHash: string;
  }[];
  /** New in the catalog, in file order (introduce them after the existing new cards). */
  add: { key: string; unit: number; content: CardContent; sourceHash: string }[];
  /** Removed from the catalog and not edited here: tombstone (review logs are kept). */
  remove: { cardId: string; key: string }[];
  /** Changed or removed in the catalog, but edited here: left as the student has it. */
  kept: { cardId: string; key: string; reason: 'changed' | 'removed' }[];
  /** For the banner: "Update available — 12 changed, 5 new, 2 removed". */
  summary: { changed: number; added: number; removed: number };
  /** For the toast: "Updated: 12 fixed, 5 added, 2 removed, 1 kept your edits." */
  applied: { fixed: number; added: number; removed: number; keptEdits: number };
}

const edited = (card: LocalCatalogCard) => contentHash(card.content) !== card.sourceHash;

/**
 * Plans the update of one catalog deck from `from` (the version the student's copy is on)
 * to `to` (the latest). Skipping versions is just a bigger diff.
 */
export function planDeckUpdate(
  localCards: readonly LocalCatalogCard[],
  from: DeckFile,
  to: DeckFile,
): DeckUpdatePlan {
  // Every local card by key, deleted ones included: a key the student deleted stays deleted.
  const local = new Map<string, LocalCatalogCard>();
  for (const card of localCards) {
    if (card.sourceKey !== null) local.set(card.sourceKey, card);
  }
  const fromKeys = new Set(from.cards.map((c) => c.key));
  const toKeys = new Set(to.cards.map((c) => c.key));
  const plan: DeckUpdatePlan = {
    replace: [],
    add: [],
    remove: [],
    kept: [],
    summary: { changed: 0, added: 0, removed: 0 },
    applied: { fixed: 0, added: 0, removed: 0, keptEdits: 0 },
  };

  for (const card of to.cards) {
    const content = cardContentOf(card);
    const hash = contentHash(content);
    const mine = local.get(card.key);
    if (mine === undefined) {
      // New in the catalog (or a key this copy never had): add it.
      plan.add.push({ key: card.key, unit: card.unit, content, sourceHash: hash });
      continue;
    }
    if (mine.deletedAt !== null) continue;
    const changed = mine.sourceHash !== hash || mine.unit !== card.unit;
    if (!changed) continue;
    plan.summary.changed += 1;
    if (edited(mine)) {
      plan.kept.push({ cardId: mine.id, key: card.key, reason: 'changed' });
    } else {
      plan.replace.push({
        cardId: mine.id,
        key: card.key,
        content,
        unit: card.unit,
        sourceHash: hash,
      });
    }
  }

  for (const key of fromKeys) {
    if (toKeys.has(key)) continue;
    const mine = local.get(key);
    if (mine === undefined || mine.deletedAt !== null) continue;
    plan.summary.removed += 1;
    if (edited(mine)) plan.kept.push({ cardId: mine.id, key, reason: 'removed' });
    else plan.remove.push({ cardId: mine.id, key });
  }

  plan.summary.added = plan.add.length;
  plan.applied = {
    fixed: plan.replace.length,
    added: plan.add.length,
    removed: plan.remove.length,
    keptEdits: plan.kept.length,
  };
  return plan;
}
