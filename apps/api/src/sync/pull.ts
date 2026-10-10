import type { PullQuery, PullResponse } from '@recall/core';
import type { Prisma } from '../db';
import { toCard, toDeck, toLog, type CardRow, type DeckRow, type LogRow } from './rows';

/**
 * One page of this user's changes after `since`, in serverSeq order (§8.3). Each table
 * is read up to limit+1 rows past the cursor; merging them by seq and keeping the first
 * `limit` gives an exact page, and any row left over means there is more.
 */
export async function pullPage(
  prisma: Prisma,
  userId: string,
  query: PullQuery,
): Promise<PullResponse> {
  const since = BigInt(query.since);
  const take = query.limit + 1;
  const [decks, cards, logs] = await Promise.all([
    prisma.$queryRaw<DeckRow[]>`
      SELECT * FROM decks WHERE user_id = ${userId} AND server_seq > ${since}
      ORDER BY server_seq LIMIT ${take}`,
    prisma.$queryRaw<CardRow[]>`
      SELECT * FROM cards WHERE user_id = ${userId} AND server_seq > ${since}
      ORDER BY server_seq LIMIT ${take}`,
    prisma.$queryRaw<LogRow[]>`
      SELECT * FROM review_logs WHERE user_id = ${userId} AND server_seq > ${since}
      ORDER BY server_seq LIMIT ${take}`,
  ]);

  const merged = [
    ...decks.map((r) => ({ seq: r.server_seq, kind: 'deck' as const, r })),
    ...cards.map((r) => ({ seq: r.server_seq, kind: 'card' as const, r })),
    ...logs.map((r) => ({ seq: r.server_seq, kind: 'log' as const, r })),
  ].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));

  const page = merged.slice(0, query.limit);
  const response: PullResponse = {
    decks: [],
    cards: [],
    reviewLogs: [],
    nextCursor: page.length === 0 ? query.since : String(page[page.length - 1]?.seq),
    hasMore: merged.length > query.limit,
  };
  for (const item of page) {
    if (item.kind === 'deck') response.decks.push(toDeck(item.r));
    else if (item.kind === 'card') response.cards.push(toCard(item.r));
    else response.reviewLogs.push(toLog(item.r));
  }
  return response;
}
