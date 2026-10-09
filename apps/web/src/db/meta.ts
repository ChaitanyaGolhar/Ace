import type { RecallDB } from './db';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  newPerDay: number;
  rolloverHour: number;
  /** IANA time zone. null = use the browser's time zone (the default). */
  timeZone: string | null;
  theme: Theme;
}

/** An in-progress study session. Kept in meta so a reload continues it. */
export interface Session {
  startedAt: number;
  /** null = all decks. */
  deckId: string | null;
}

export type StoragePersistence = 'granted' | 'denied' | 'unsupported';

/** Every key stored in the `meta` table, with the type of its value. */
export interface MetaMap {
  deviceId: string;
  schedulerVersion: number;
  storagePersistence: StoragePersistence;
  settings: Settings;
  session: Session | null;
}

export type MetaKey = keyof MetaMap;

export async function getMeta<K extends MetaKey>(
  db: RecallDB,
  key: K,
): Promise<MetaMap[K] | undefined> {
  const row = await db.meta.get(key);
  // The table is untyped storage; MetaMap is the single place that defines what
  // each key holds, and setMeta is the only writer.
  return row?.value as MetaMap[K] | undefined;
}

export async function setMeta<K extends MetaKey>(
  db: RecallDB,
  key: K,
  value: MetaMap[K],
): Promise<void> {
  await db.meta.put({ key, value });
}
