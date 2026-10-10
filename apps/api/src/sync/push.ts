import {
  lww,
  mergeLog,
  type Card,
  type Deck,
  type PushRequest,
  type PushResponse,
  type ReviewLog,
  sameRow,
} from '@recall/core';
import type { Prisma } from '../db';
import { HttpError } from '../errors';
import type { Logger } from '../logger';
import {
  toCard,
  toDeck,
  toLog,
  type CardRow,
  type DeckRow,
  type EventRow,
  type LogRow,
} from './rows';

const DAY = 86_400_000;

/**
 * Applies one push (brief §8.2) inside a single transaction.
 *
 * The first statement takes `pg_advisory_xact_lock(hashtext(userId))`. That serialises
 * every push of one user, so for that user the order in which `nextval('change_seq')`
 * hands out serverSeq values is the order in which the rows commit. Without it, two
 * concurrent pushes could commit out of seq order, and a pull that ran in between would
 * move its cursor past a seq that commits a moment later: that row would never be
 * pulled. (The lock is released automatically at COMMIT/ROLLBACK.)
 */
export async function applyPush(
  prisma: Prisma,
  userId: string,
  batch: PushRequest,
  now: number,
  logger: Logger,
): Promise<PushResponse> {
  const clamp = clampFuture(now, logger);
  const decks = batch.decks.map((d) => ({
    ...d,
    createdAt: clamp(d.createdAt, 'deck', d.id),
    updatedAt: clamp(d.updatedAt, 'deck', d.id),
    deletedAt: d.deletedAt === null ? null : clamp(d.deletedAt, 'deck', d.id),
  }));
  const cards = batch.cards.map((c) => ({
    ...c,
    createdAt: clamp(c.createdAt, 'card', c.id),
    updatedAt: clamp(c.updatedAt, 'card', c.id),
    deletedAt: c.deletedAt === null ? null : clamp(c.deletedAt, 'card', c.id),
  }));
  const logs = batch.reviewLogs.map((l) => ({
    ...l,
    reviewedAt: clamp(l.reviewedAt, 'review log', l.id),
    voidedAt: l.voidedAt === null ? null : clamp(l.voidedAt, 'review log', l.id),
  }));
  const events = batch.events.map((e) => ({
    ...e,
    occurredAt: clamp(e.occurredAt, 'event', e.id),
  }));

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      const storedDecks = await tx.$queryRaw<DeckRow[]>`
        SELECT * FROM decks WHERE id = ANY(${decks.map((d) => d.id)}::text[]) FOR UPDATE`;
      const storedCards = await tx.$queryRaw<CardRow[]>`
        SELECT * FROM cards WHERE id = ANY(${cards.map((c) => c.id)}::text[]) FOR UPDATE`;
      const storedLogs = await tx.$queryRaw<LogRow[]>`
        SELECT * FROM review_logs WHERE id = ANY(${logs.map((l) => l.id)}::text[]) FOR UPDATE`;

      const storedEvents = await tx.$queryRaw<Pick<EventRow, 'id' | 'user_id'>[]>`
        SELECT id, user_id FROM events WHERE id = ANY(${events.map((e) => e.id)}::text[])`;

      // Ownership: any id that already belongs to someone else rejects the whole batch.
      if (
        [...storedDecks, ...storedCards, ...storedLogs, ...storedEvents].some(
          (r) => r.user_id !== userId,
        )
      ) {
        throw new HttpError(403, 'forbidden', 'A row in this batch belongs to another account');
      }

      // A card must reference a deck of this user: in this batch, or already stored.
      const batchDeckIds = new Set(decks.map((d) => d.id));
      const missing = [...new Set(cards.map((c) => c.deckId))].filter(
        (id) => !batchDeckIds.has(id),
      );
      if (missing.length > 0) {
        const found = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM decks WHERE user_id = ${userId} AND id = ANY(${missing}::text[])`;
        if (found.length !== missing.length) {
          throw new HttpError(400, 'unknown_deck', 'A card references a deck that doesn’t exist');
        }
      }

      // Order within a batch: decks → cards → logs.
      const deckById = new Map(storedDecks.map((r) => [r.id, toDeck(r)]));
      for (const incoming of decks) {
        const stored = deckById.get(incoming.id);
        if (!stored) {
          await insertDeck(tx, userId, incoming);
        } else {
          const winner = lww(stored, incoming);
          if (!sameRow(winner, stored)) await updateDeck(tx, winner);
        }
        deckById.set(incoming.id, deckById.get(incoming.id) ?? incoming);
      }

      const cardById = new Map(storedCards.map((r) => [r.id, toCard(r)]));
      for (const incoming of cards) {
        const stored = cardById.get(incoming.id);
        if (!stored) {
          await insertCard(tx, userId, incoming);
          cardById.set(incoming.id, incoming);
        } else {
          const winner = lww(stored, incoming);
          if (!sameRow(winner, stored)) {
            await updateCard(tx, winner);
            cardById.set(incoming.id, winner);
          }
        }
      }

      const logById = new Map(storedLogs.map((r) => [r.id, toLog(r)]));
      for (const incoming of logs) {
        const stored = logById.get(incoming.id);
        if (!stored) {
          // ON CONFLICT DO NOTHING also covers a duplicate id inside this very batch.
          await insertLog(tx, userId, incoming);
          logById.set(incoming.id, incoming);
        } else {
          // Logs are append-only: only voidedAt may change, null → earliest timestamp.
          const merged = mergeLog(stored, incoming);
          if (merged.voidedAt !== stored.voidedAt) {
            await tx.$executeRaw`
              UPDATE review_logs SET voided_at = ${merged.voidedAt}, server_seq = nextval('change_seq')
              WHERE id = ${stored.id}`;
            logById.set(stored.id, { ...stored, voidedAt: merged.voidedAt });
          }
        }
      }

      // Events are append-only: insert if absent, never changed.
      for (const e of events) {
        await tx.$executeRaw`
          INSERT INTO events (id, user_id, type, occurred_at, device_id, props, server_seq)
          VALUES (${e.id}, ${userId}, ${e.type}, ${e.occurredAt}, ${e.deviceId},
                  ${JSON.stringify(e.props)}::jsonb, nextval('change_seq'))
          ON CONFLICT (id) DO NOTHING`;
      }
    },
    { maxWait: 10_000, timeout: 60_000 },
  );

  return {
    accepted: {
      decks: batch.decks.map((d) => d.id),
      cards: batch.cards.map((c) => c.id),
      reviewLogs: batch.reviewLogs.map((l) => l.id),
      events: batch.events.map((e) => e.id),
    },
  };
}

type Tx = Parameters<Parameters<Prisma['$transaction']>[0]>[0];

function insertDeck(tx: Tx, userId: string, d: Deck) {
  return tx.$executeRaw`
    INSERT INTO decks (id, user_id, name, source, prebuilt_id, catalog_slug, catalog_version,
                       created_at, updated_at, deleted_at, server_seq)
    VALUES (${d.id}, ${userId}, ${d.name}, ${d.source}, ${d.prebuiltId}, ${d.catalogSlug},
            ${d.catalogVersion}, ${d.createdAt}, ${d.updatedAt}, ${d.deletedAt}, nextval('change_seq'))`;
}

function updateDeck(tx: Tx, d: Deck) {
  return tx.$executeRaw`
    UPDATE decks SET name = ${d.name}, source = ${d.source}, prebuilt_id = ${d.prebuiltId},
      catalog_slug = ${d.catalogSlug}, catalog_version = ${d.catalogVersion},
      created_at = ${d.createdAt}, updated_at = ${d.updatedAt}, deleted_at = ${d.deletedAt},
      server_seq = nextval('change_seq')
    WHERE id = ${d.id}`;
}

function insertCard(tx: Tx, userId: string, c: Card) {
  return tx.$executeRaw`
    INSERT INTO cards (id, user_id, deck_id, front, back, type, content, unit, source_key, source_hash,
                       created_at, updated_at, deleted_at, server_seq)
    VALUES (${c.id}, ${userId}, ${c.deckId}, ${c.front}, ${c.back}, ${c.type},
            ${JSON.stringify(c.content)}::jsonb, ${c.unit}, ${c.sourceKey}, ${c.sourceHash},
            ${c.createdAt}, ${c.updatedAt}, ${c.deletedAt}, nextval('change_seq'))`;
}

function updateCard(tx: Tx, c: Card) {
  return tx.$executeRaw`
    UPDATE cards SET deck_id = ${c.deckId}, front = ${c.front}, back = ${c.back}, type = ${c.type},
      content = ${JSON.stringify(c.content)}::jsonb, unit = ${c.unit}, source_key = ${c.sourceKey},
      source_hash = ${c.sourceHash}, created_at = ${c.createdAt}, updated_at = ${c.updatedAt},
      deleted_at = ${c.deletedAt}, server_seq = nextval('change_seq')
    WHERE id = ${c.id}`;
}

function insertLog(tx: Tx, userId: string, l: ReviewLog) {
  return tx.$executeRaw`
    INSERT INTO review_logs (id, user_id, card_id, rating, reviewed_at, duration_ms, device_id, voided_at,
                             outcome, server_seq)
    VALUES (${l.id}, ${userId}, ${l.cardId}, ${l.rating}, ${l.reviewedAt}, ${l.durationMs}, ${l.deviceId},
            ${l.voidedAt}, ${l.outcome === null ? null : JSON.stringify(l.outcome)}::jsonb,
            nextval('change_seq'))
    ON CONFLICT (id) DO NOTHING`;
}

/** Clock sanity (§8.2): anything more than 24h in the future becomes `now`, with a warning. */
function clampFuture(now: number, logger: Logger) {
  return (t: number, what: string, id: string): number => {
    if (t <= now + DAY) return t;
    logger.warn(
      `Clamped a ${what} timestamp in the future (${what} ${id}: ${String(t)} → ${String(now)})`,
    );
    return now;
  };
}
