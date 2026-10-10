import type { PullQuery, PullResponse } from '@recall/core';
import type { Prisma } from '../db';
import {
  toCard,
  toDeck,
  toEvent,
  toLog,
  type CardRow,
  type DeckRow,
  type EventRow,
  type LogRow,
} from './rows';

/**
 * One page of this user's changes after `since`, in serverSeq order (§8.3). Each table
 * is read up to limit+1 rows past the cursor; merging them by seq and keeping the first
 * `limit` gives an exact page, and any row left over means there is more.
 *
 * The three reads run in one REPEATABLE READ transaction, i.e. against one snapshot.
 * With three independent reads, a push could commit between them: the page would then
 * contain that push's logs (high seqs) but not its deck (a lower seq read earlier), and
 * nextCursor would jump past the deck for ever. (The concurrency test caught this.)
 */
export async function pullPage(
  prisma: Prisma,
  userId: string,
  query: PullQuery,
): Promise<PullResponse> {
  const since = BigInt(query.since);
  const take = query.limit + 1;
  const [decks, cards, logs, events] = await prisma.$transaction(
    async (tx) =>
      [
        await tx.$queryRaw<DeckRow[]>`
        SELECT * FROM decks WHERE user_id = ${userId} AND server_seq > ${since}
        ORDER BY server_seq LIMIT ${take}`,
        await tx.$queryRaw<CardRow[]>`
        SELECT * FROM cards WHERE user_id = ${userId} AND server_seq > ${since}
        ORDER BY server_seq LIMIT ${take}`,
        await tx.$queryRaw<LogRow[]>`
        SELECT * FROM review_logs WHERE user_id = ${userId} AND server_seq > ${since}
        ORDER BY server_seq LIMIT ${take}`,
        await tx.$queryRaw<EventRow[]>`
        SELECT * FROM events WHERE user_id = ${userId} AND server_seq > ${since}
        ORDER BY server_seq LIMIT ${take}`,
      ] as const,
    { isolationLevel: 'RepeatableRead' },
  );

  const merged = [
    ...decks.map((r) => ({ seq: r.server_seq, kind: 'deck' as const, r })),
    ...cards.map((r) => ({ seq: r.server_seq, kind: 'card' as const, r })),
    ...logs.map((r) => ({ seq: r.server_seq, kind: 'log' as const, r })),
    ...events.map((r) => ({ seq: r.server_seq, kind: 'event' as const, r })),
  ].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));

  const page = merged.slice(0, query.limit);
  const response: PullResponse = {
    decks: [],
    cards: [],
    reviewLogs: [],
    events: [],
    nextCursor: page.length === 0 ? query.since : String(page[page.length - 1]?.seq),
    hasMore: merged.length > query.limit,
  };
  for (const item of page) {
    if (item.kind === 'deck') response.decks.push(toDeck(item.r));
    else if (item.kind === 'card') response.cards.push(toCard(item.r));
    else if (item.kind === 'log') response.reviewLogs.push(toLog(item.r));
    else response.events.push(toEvent(item.r));
  }
  return response;
}
