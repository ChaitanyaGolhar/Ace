import { useLiveQuery } from 'dexie-react-hooks';

export type QueryResult<T> =
  { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T };

/**
 * A live IndexedDB query (re-runs whenever the tables it read change), with explicit
 * loading and error states instead of `undefined` and a thrown render error.
 */
export function useQuery<T>(querier: () => Promise<T>, deps: unknown[]): QueryResult<T> {
  const result = useLiveQuery(async () => {
    try {
      return { ok: true as const, value: await querier() };
    } catch (error) {
      return { ok: false as const, error };
    }
  }, deps);
  if (result === undefined) return { status: 'loading' };
  if (!result.ok) return { status: 'error', error: result.error };
  return { status: 'ready', data: result.value };
}
