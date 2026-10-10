import type { CatalogDeckSummary } from '@recall/core';
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
  /** M7 (§7.7): only this syllabus unit of the deck. Absent = every unit. */
  unit?: number;
  /** Set when the session-complete screen was shown. A completed session is never continued. */
  completedAt?: number;
}

export type StoragePersistence = 'granted' | 'denied' | 'unsupported';

/** Cached account state, so the app knows offline whether it is signed in (§9.1). */
export interface AuthState {
  signedIn: boolean;
  email: string | null;
}

/** Every key stored in the `meta` table, with the type of its value. */
export interface MetaMap {
  deviceId: string;
  schedulerVersion: number;
  storagePersistence: StoragePersistence;
  settings: Settings;
  session: Session | null;
  auth: AuthState;
  /** Last serverSeq pulled (a bigint, as a decimal string). */
  syncCursor: string;
  /** M7: the store list as last fetched, shown offline (§7.5). */
  catalogCache: { decks: CatalogDeckSummary[]; fetchedAt: number };
  /** M7: the latest published version of each catalog deck, as last seen (§7.6). */
  catalogLatest: Record<string, number>;
  /** M7: when the catalog was last checked for updates (epoch ms). */
  catalogCheckedAt: number;
  /** M7: the store's filters, remembered on this device. */
  storeFilters: StoreFilters;
  /** M8: paid decks this account has unlocked (slugs), as last fetched. */
  entitlements: string[];
  /** M8: "Sign in to unlock": the store page to come back to after the magic link. */
  signInReturnTo: string | null;
}

export interface StoreFilters {
  year: string | null;
  semester: number | null;
  branch: string | null;
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
