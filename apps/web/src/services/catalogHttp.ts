import { CatalogDetailSchema, CatalogListSchema, validateDeckFile } from '@recall/core';
import { CatalogOfflineError, type CatalogApi } from './catalog';

// The catalog endpoints over HTTP (BUILD_BRIEF_M6_M8 §7.3). Sent with the session cookie:
// paid versions (M8) need it; free ones ignore it.

/** The deck or version doesn't exist (404). */
export class CatalogNotFoundError extends Error {
  constructor() {
    super('This deck isn’t in the store.');
    this.name = 'CatalogNotFoundError';
  }
}

/** The version is paid and this user hasn't unlocked it (403). */
export class CatalogForbiddenError extends Error {
  constructor() {
    super('This deck is paid. Unlock it to add it.');
    this.name = 'CatalogForbiddenError';
  }
}

export function httpCatalogApi(apiUrl: string, fetchFn: typeof fetch): CatalogApi {
  const get = async (path: string): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetchFn(`${apiUrl}${path}`, { credentials: 'include' });
    } catch {
      throw new CatalogOfflineError();
    }
    if (res.status === 404) throw new CatalogNotFoundError();
    if (res.status === 403) throw new CatalogForbiddenError();
    if (!res.ok) throw new Error(`catalog request failed (${String(res.status)})`);
    return res.json();
  };
  return {
    list: async () => CatalogListSchema.parse(await get('/catalog')),
    detail: async (slug) =>
      CatalogDetailSchema.parse(await get(`/catalog/${encodeURIComponent(slug)}`)),
    version: async (slug, version) => {
      const result = validateDeckFile(
        await get(`/catalog/${encodeURIComponent(slug)}/versions/${String(version)}`),
      );
      if (!result.ok)
        throw new Error(`invalid deck file from the server: ${result.errors[0] ?? ''}`);
      return result.deck;
    },
  };
}
