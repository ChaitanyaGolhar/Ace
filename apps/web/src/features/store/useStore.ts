import { useEffect, useRef, useState } from 'react';
import type { CatalogDeckSummary } from '@recall/core';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import { getMeta, setMeta, type StoreFilters } from '../../db/meta';
import { loadStore, ownedCatalogSlugs } from '../../services/catalog';
import { recordEvent } from '../../services/events';
import { branchesIn, filterStoreDecks, semestersFor } from './storeView';

// The store list (BUILD_BRIEF_M6_M8 §7.7). The list comes from the API, or the cached
// copy offline; filters are remembered on this device.

export interface StoreRow {
  deck: CatalogDeckSummary;
  inMyDecks: boolean;
}

export interface StoreViewModel {
  status: 'loading' | 'error' | 'unavailable' | 'ready';
  /** Showing the cached list; when it was fetched. */
  offlineSince: number | null;
  filters: StoreFilters;
  search: string;
  years: readonly string[];
  semesters: number[];
  branches: string[];
  rows: StoreRow[];
  /** Any deck at all (before filtering). */
  hasDecks: boolean;
  setYear: (year: string | null) => void;
  setSemester: (semester: number | null) => void;
  setBranch: (branch: string | null) => void;
  setSearch: (q: string) => void;
  clearFilters: () => void;
}

const NO_FILTERS: StoreFilters = { year: null, semester: null, branch: null };

export function useStore(): StoreViewModel {
  const { ctx, catalog } = useServices();
  const [listing, setListing] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'unavailable' }
    | {
        status: 'ready';
        decks: CatalogDeckSummary[];
        offlineSince: number | null;
      }
  >({ status: 'loading' });
  const [filters, setFilters] = useState<StoreFilters>(NO_FILTERS);
  const [search, setSearch] = useState('');
  const opened = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (!opened.current) {
      opened.current = true;
      void recordEvent(ctx, 'store_opened', {}).catch(() => undefined);
    }
    void getMeta(ctx.db, 'storeFilters').then((saved) => {
      if (!cancelled && saved) setFilters(saved);
    });
    loadStore(ctx, catalog).then(
      (store) => {
        if (cancelled) return;
        setListing(
          store
            ? {
                status: 'ready',
                decks: store.decks,
                offlineSince: store.offline ? store.fetchedAt : null,
              }
            : { status: 'unavailable' },
        );
      },
      () => {
        if (!cancelled) setListing({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ctx, catalog]);

  const owned = useQuery(() => ownedCatalogSlugs(ctx), [ctx]);
  const ownedSlugs = owned.status === 'ready' ? owned.data : new Set<string>();

  const update = (next: StoreFilters) => {
    setFilters(next);
    void setMeta(ctx.db, 'storeFilters', next).catch(() => undefined);
  };

  const decks = listing.status === 'ready' ? listing.decks : [];
  return {
    status: listing.status,
    offlineSince: listing.status === 'ready' ? listing.offlineSince : null,
    filters,
    search,
    years: ['FE', 'SE', 'TE', 'BE'],
    semesters: semestersFor(filters.year, decks),
    branches: branchesIn(decks),
    rows: filterStoreDecks(decks, filters, search).map((deck) => ({
      deck,
      inMyDecks: ownedSlugs.has(deck.slug),
    })),
    hasDecks: decks.length > 0,
    setYear: (year) => {
      // A semester from another year no longer applies.
      const semester =
        filters.semester !== null &&
        year !== null &&
        !semestersFor(year, decks).includes(filters.semester)
          ? null
          : filters.semester;
      update({ ...filters, year, semester });
    },
    setSemester: (semester) => {
      update({ ...filters, semester });
    },
    setBranch: (branch) => {
      update({ ...filters, branch });
    },
    setSearch,
    clearFilters: () => {
      update(NO_FILTERS);
      setSearch('');
    },
  };
}
