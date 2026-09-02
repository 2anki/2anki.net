import knex from 'knex';

import { ConversionResultCacheRepository } from './ConversionResultCacheRepository';
import type { DeckInfo } from '../lib/claude/ClaudeService';
import type { ConversionResultCacheSave } from '../lib/claude/conversionResultCache';

function sampleDeck(): DeckInfo[] {
  return [
    {
      name: 'Deck',
      image: '',
      style: null,
      id: 1,
      settings: {},
      cards: [
        {
          name: 'q',
          back: 'a',
          tags: [],
          cloze: false,
          number: 0,
          enableInput: false,
          answer: '',
          media: [],
        },
      ],
    },
  ];
}

function sampleSave(): ConversionResultCacheSave<DeckInfo[]> {
  return {
    key: 'a'.repeat(64),
    result: sampleDeck(),
    model: 'claude-sonnet-5',
    promptVersion: 'abc123',
  };
}

describe('ConversionResultCacheRepository generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new ConversionResultCacheRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('reads a live entry by key with a ttl cutoff on created_at', () => {
    const cutoff = new Date('2026-01-01T00:00:00.000Z');
    const { sql, bindings } = repository
      .buildGetQuery('a'.repeat(64), cutoff)
      .toSQL();

    expect(sql).toBe(
      'select * from "conversion_result_cache" ' +
        'where "cache_key" = ? and "created_at" >= ? limit ?'
    );
    expect(bindings).toEqual(['a'.repeat(64), cutoff, 1]);
  });

  it('upserts on the cache key, refreshing the payload on conflict', () => {
    const { sql, bindings } = repository.buildSaveQuery(sampleSave()).toSQL();

    expect(sql).toBe(
      'insert into "conversion_result_cache" ' +
        '("cache_key", "card_count", "created_at", "deck_info", "last_accessed_at", "model", "prompt_version") ' +
        'values (?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, ?, ?) ' +
        'on conflict ("cache_key") ' +
        'do update set "model" = ?,"prompt_version" = ?,"deck_info" = ?,' +
        '"card_count" = ?,"created_at" = CURRENT_TIMESTAMP,' +
        '"last_accessed_at" = CURRENT_TIMESTAMP'
    );
    expect(bindings).toEqual([
      'a'.repeat(64),
      1,
      JSON.stringify(sampleDeck()),
      'claude-sonnet-5',
      'abc123',
      'claude-sonnet-5',
      'abc123',
      JSON.stringify(sampleDeck()),
      1,
    ]);
  });
});
