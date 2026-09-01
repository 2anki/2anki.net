import type { Knex } from 'knex';

import type { DeckInfo } from '../lib/claude/ClaudeService';
import type {
  ConversionResultCacheSave,
  ConversionResultCacheStore,
} from '../lib/claude/conversionResultCache';
import { getDatabase } from './index';

interface ConversionResultCacheRow {
  id: number;
  cache_key: string;
  model: string;
  prompt_version: string;
  deck_info: DeckInfo[];
  card_count: number;
  hits: number;
  created_at: Date;
  last_accessed_at: Date;
}

// A cache entry stays valid as long as its key holds (key already encodes
// content, settings, model, and prompt version), so this ttl is storage hygiene
// only: it bounds table growth and lets an old entry fall out rather than being
// served forever. A physical reaper can call deleteOlderThan on the same bound.
export const CONVERSION_CACHE_TTL_DAYS = 30;

export type IConversionResultCacheRepository = ConversionResultCacheStore<
  DeckInfo[]
>;

function countCards(decks: DeckInfo[]): number {
  return decks.reduce((sum, deck) => sum + deck.cards.length, 0);
}

export class ConversionResultCacheRepository implements ConversionResultCacheStore<
  DeckInfo[]
> {
  private readonly table = 'conversion_result_cache';

  constructor(
    private readonly database: Knex,
    private readonly ttlDays: number = CONVERSION_CACHE_TTL_DAYS
  ) {}

  buildGetQuery(key: string, cutoff: Date): Knex.QueryBuilder {
    return this.database(this.table)
      .where({ cache_key: key })
      .andWhere('created_at', '>=', cutoff)
      .first();
  }

  buildSaveQuery(
    entry: ConversionResultCacheSave<DeckInfo[]>
  ): Knex.QueryBuilder {
    const deckInfo = JSON.stringify(entry.result);
    const cardCount = countCards(entry.result);
    return this.database(this.table)
      .insert({
        cache_key: entry.key,
        model: entry.model,
        prompt_version: entry.promptVersion,
        deck_info: deckInfo,
        card_count: cardCount,
        created_at: this.database.fn.now(),
        last_accessed_at: this.database.fn.now(),
      })
      .onConflict('cache_key')
      .merge({
        model: entry.model,
        prompt_version: entry.promptVersion,
        deck_info: deckInfo,
        card_count: cardCount,
        created_at: this.database.fn.now(),
        last_accessed_at: this.database.fn.now(),
      });
  }

  async get(key: string): Promise<DeckInfo[] | undefined> {
    const cutoff = new Date(Date.now() - this.ttlDays * 24 * 60 * 60 * 1000);
    const row: ConversionResultCacheRow | undefined = await this.buildGetQuery(
      key,
      cutoff
    );
    if (row == null) return undefined;
    this.bumpHit(key, row.hits);
    return row.deck_info;
  }

  async save(entry: ConversionResultCacheSave<DeckInfo[]>): Promise<void> {
    await this.buildSaveQuery(entry);
  }

  async deleteOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.database(this.table).where('created_at', '<', cutoff).del();
  }

  private bumpHit(key: string, currentHits: number): void {
    void this.database(this.table)
      .where({ cache_key: key })
      .update({
        hits: currentHits + 1,
        last_accessed_at: this.database.fn.now(),
      })
      .then(undefined, (error: unknown) => {
        console.warn('[ConversionResultCache] hit counter update failed', {
          key: key.slice(0, 12),
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

// Content-addressed and user-agnostic on purpose: the key is content + settings
// + model, never the uploader, so two people converting the same file with
// identical settings share one entry. There is no leak — the second uploader
// supplied that same content and receives cards derived only from it.
export function getConversionResultCache():
  | ConversionResultCacheStore<DeckInfo[]>
  | undefined {
  if (!process.env.DATABASE_URL) return undefined;
  return new ConversionResultCacheRepository(getDatabase());
}

export default ConversionResultCacheRepository;
