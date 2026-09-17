export interface NewFavorite {
  object_id: string;
  owner: string;
  type: string;
}

const FAVORITE_TYPES = new Set(['page', 'database']);

/**
 * Several callers into /rules/:id (Preview, per-page Card Options, Ankify's
 * Notion pickers) never carry the Notion object type through their links, so
 * this always falls back to 'page' rather than rejecting the favorite - the
 * enrichment use case already retries as a database on a type mismatch.
 */
export const resolveFavoriteType = (type: string | undefined | null) =>
  type && FAVORITE_TYPES.has(type) ? type : 'page';

export const isValidFavoriteInput = (object_id: string, type: string) =>
  object_id && type;
