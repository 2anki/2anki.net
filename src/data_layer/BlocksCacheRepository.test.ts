import Knex from 'knex';
import type { ListBlockChildrenResponse } from '@notionhq/client/build/src/api-endpoints';

import {
  BlocksCacheRepository,
  incrementFetchCounter,
} from './BlocksCacheRepository';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const knex = Knex({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true,
});

beforeAll(async () => {
  await knex.schema.createTable('blocks', (table) => {
    table.increments('id').primary();
    table.string('owner').notNullable();
    table.string('object_id').notNullable();
    table.json('payload').notNullable();
    table.integer('fetch').notNullable().defaultTo(0);
    table.timestamp('created_at').notNullable();
    table.timestamp('last_edited_time').notNullable();
    table.unique(['object_id', 'owner']);
  });
});

afterAll(() => knex.destroy());

afterEach(() => knex('blocks').del());

describe('BlocksCacheRepository', () => {
  const repo = new BlocksCacheRepository(knex);
  const payload = {
    type: 'block' as const,
    block: {},
    object: 'list' as const,
    next_cursor: null,
    has_more: false,
    results: [],
  };

  it('get for user A does not increment user B fetch counter', async () => {
    await repo.save({
      id: 'shared-page',
      owner: 'user-a',
      payload,
      createdAt: '2024-01-01',
      lastEditedAt: '2024-01-02',
    });
    await repo.save({
      id: 'shared-page',
      owner: 'user-b',
      payload,
      createdAt: '2024-01-01',
      lastEditedAt: '2024-01-02',
    });

    await repo.get({
      id: 'shared-page',
      owner: 'user-a',
      lastEditedAt: '2024-01-01',
    });

    const rowB = await knex('blocks')
      .where({ object_id: 'shared-page', owner: 'user-b' })
      .first();
    expect(rowB.fetch).toBe(1);
  });

  it('save for user A does not clobber user B row', async () => {
    const payloadA = {
      ...payload,
      results: [{ id: 'a' }],
    } as unknown as ListBlockChildrenResponse;
    const payloadB = {
      ...payload,
      results: [{ id: 'b' }],
    } as unknown as ListBlockChildrenResponse;

    await repo.save({
      id: 'shared-page',
      owner: 'user-a',
      payload: payloadA,
      createdAt: '2024-01-01',
      lastEditedAt: '2024-01-02',
    });
    await repo.save({
      id: 'shared-page',
      owner: 'user-b',
      payload: payloadB,
      createdAt: '2024-01-01',
      lastEditedAt: '2024-01-02',
    });

    const rowA = await knex('blocks')
      .where({ object_id: 'shared-page', owner: 'user-a' })
      .first();
    const rowB = await knex('blocks')
      .where({ object_id: 'shared-page', owner: 'user-b' })
      .first();

    expect(JSON.parse(rowA.payload).results[0].id).toBe('a');
    expect(JSON.parse(rowB.payload).results[0].id).toBe('b');
  });

  it('get increments the fetch counter for the owner', async () => {
    await repo.save({
      id: 'page-1',
      owner: 'user-a',
      payload,
      createdAt: '2024-01-01',
      lastEditedAt: '2024-01-02',
    });

    await repo.get({
      id: 'page-1',
      owner: 'user-a',
      lastEditedAt: '2024-01-01',
    });
    await flushMicrotasks();

    const row = await knex('blocks')
      .where({ object_id: 'page-1', owner: 'user-a' })
      .first();
    expect(row.fetch).toBe(2);
  });

  it('get returns the cached payload and warns when the counter update fails', async () => {
    const failing = Knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await failing.schema.createTable('blocks', (table) => {
      table.increments('id').primary();
      table.string('owner').notNullable();
      table.string('object_id').notNullable();
      table.json('payload').notNullable();
      table.integer('fetch').notNullable().defaultTo(0);
      table.timestamp('created_at').notNullable();
      table.timestamp('last_edited_time').notNullable();
      table.unique(['object_id', 'owner']);
    });
    const failingRepo = new BlocksCacheRepository(failing);
    await failingRepo.save({
      id: 'page-1',
      owner: 'user-a',
      payload,
      createdAt: '2024-01-01',
      lastEditedAt: '2024-01-02',
    });
    await failing.schema.alterTable('blocks', (table) =>
      table.dropColumn('fetch')
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await failingRepo.get({
      id: 'page-1',
      owner: 'user-a',
      lastEditedAt: '2024-01-01',
    });
    await flushMicrotasks();

    expect(result).toBe(JSON.stringify(payload));
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    await failing.destroy();
  });

  it('get returns cached payload when lastEditedAt has not changed', async () => {
    await repo.save({
      id: 'page-1',
      owner: 'user-a',
      payload,
      createdAt: '2024-01-01',
      lastEditedAt: '2024-01-02',
    });

    const result = await repo.get({
      id: 'page-1',
      owner: 'user-a',
      lastEditedAt: '2024-01-02',
    });

    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsed).toEqual(payload);
  });

  it('get returns undefined when page has been edited since cache', async () => {
    await repo.save({
      id: 'page-1',
      owner: 'user-a',
      payload,
      createdAt: '2024-01-01',
      lastEditedAt: '2024-01-02',
    });

    const result = await repo.get({
      id: 'page-1',
      owner: 'user-a',
      lastEditedAt: '2024-06-01',
    });

    expect(result).toBeUndefined();
  });
});

describe('BlocksCacheRepository fetch counter SQL', () => {
  const postgres = Knex({ client: 'pg' });

  afterAll(() => postgres.destroy());

  it('quotes the reserved word fetch on both sides of the increment for Postgres', () => {
    const sql = postgres('blocks')
      .where({ object_id: 'page-1', owner: 'owner-1' })
      .update({ fetch: incrementFetchCounter(postgres) })
      .toString();

    expect(sql).toBe(
      `update "blocks" set "fetch" = "fetch" + 1 where "object_id" = 'page-1' and "owner" = 'owner-1'`
    );
  });

  it('emits the increment through the same helper when a cached page is read', async () => {
    const statements: string[] = [];
    const listener = (query: { sql: string }) => statements.push(query.sql);
    knex.on('query', listener);
    await knex('blocks').insert({
      owner: 'owner-sql',
      object_id: 'page-sql',
      payload: JSON.stringify({ results: [] }),
      fetch: 1,
      created_at: new Date('2026-01-01T00:00:00Z'),
      last_edited_time: new Date('2026-01-01T00:00:00Z'),
    });

    await new BlocksCacheRepository(knex).get({
      id: 'page-sql',
      owner: 'owner-sql',
      lastEditedAt: '2026-01-01T00:00:00.000Z',
    });
    await flushMicrotasks();
    knex.removeListener('query', listener);

    const update = statements.find((sql) => sql.startsWith('update'));
    expect(update).toContain('`fetch` = `fetch` + 1');
  });
});
