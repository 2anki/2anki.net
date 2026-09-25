import knex from 'knex';
import { CardGuidLedgerRepository } from './CardGuidLedgerRepository';

interface CapturedInsert {
  rows: Array<Record<string, unknown>>;
  conflictColumns?: string[];
  ignored: boolean;
  mergedColumns?: string[];
}

function captureDatabase(calls: CapturedInsert[]): knex.Knex {
  const fake = {
    insert(rows: Array<Record<string, unknown>>) {
      const call: CapturedInsert = { rows, ignored: false };
      calls.push(call);
      return {
        onConflict(columns: string[]) {
          call.conflictColumns = columns;
          return {
            ignore: async () => {
              call.ignored = true;
            },
            merge: async (columns: string[]) => {
              call.mergedColumns = columns;
            },
          };
        },
      };
    },
  };
  return (() => fake) as unknown as knex.Knex;
}

describe('CardGuidLedgerRepository SQL generation', () => {
  it('record guards every batch with onConflict(owner, block_id) ignore', async () => {
    const calls: CapturedInsert[] = [];
    const repo = new CardGuidLedgerRepository(captureDatabase(calls));

    await repo.record(7, [
      { blockId: 'block-a', sourcePageId: 'page-1', guid: 'guid-a' },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].conflictColumns).toEqual(['owner', 'block_id']);
    expect(calls[0].ignored).toBe(true);
  });

  it('reissue upserts the guid and content_changed_at on conflict instead of ignoring it', async () => {
    const calls: CapturedInsert[] = [];
    const repo = new CardGuidLedgerRepository(captureDatabase(calls));

    await repo.reissue(7, [
      {
        blockId: 'block-a',
        sourcePageId: 'page-1',
        guid: 'block-guid-a',
        contentChangedAt: 1_700_000_000,
      },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].rows).toEqual([
      {
        owner: 7,
        block_id: 'block-a',
        source_page_id: 'page-1',
        guid: 'block-guid-a',
        content_changed_at: new Date(1_700_000_000 * 1000),
      },
    ]);
    expect(calls[0].conflictColumns).toEqual(['owner', 'block_id']);
    expect(calls[0].mergedColumns).toEqual([
      'guid',
      'source_page_id',
      'content_changed_at',
    ]);
    expect(calls[0].ignored).toBe(false);
  });

  it('record chunks large batches and drops over-length ids', async () => {
    const calls: CapturedInsert[] = [];
    const repo = new CardGuidLedgerRepository(captureDatabase(calls));

    const entries = Array.from({ length: 1001 }, (_, i) => ({
      blockId: `block-${i}`,
      guid: `guid-${i}`,
    }));
    entries.push({ blockId: 'x'.repeat(300), guid: 'guid-huge' });

    await repo.record(7, entries);

    expect(calls).toHaveLength(3);
    const total = calls.reduce((sum, c) => sum + c.rows.length, 0);
    expect(total).toBe(1001);
  });

  it('getAllForOwner returns a block_id to guid record without upload rows', async () => {
    const rows = [
      { block_id: 'block-a', guid: 'guid-a' },
      { block_id: 'block-b', guid: 'guid-b' },
    ];
    const whereNot = jest.fn().mockResolvedValue(rows);
    const fake = {
      select: () => ({ where: () => ({ whereNot }) }),
    };
    const database = (() => fake) as unknown as knex.Knex;
    const repo = new CardGuidLedgerRepository(database);

    const known = await repo.getAllForOwner(7);

    expect(known).toEqual({ 'block-a': 'guid-a', 'block-b': 'guid-b' });
    expect(whereNot).toHaveBeenCalledWith('block_id', 'like', 'u:%');
  });

  it('getUploadIdentityForOwner filters u: rows and returns guid + source + content_changed_at', async () => {
    const rows = [
      {
        block_id: 'u:abc',
        guid: 'guid-a',
        source_page_id: 'hash:fp',
        content_changed_at: new Date(1_700_000_000 * 1000),
      },
      {
        block_id: 'u:def',
        guid: 'guid-b',
        source_page_id: null,
        content_changed_at: null,
      },
    ];
    let capturedWhere: unknown;
    const captured: unknown[] = [];
    const fake = {
      select: () => ({
        where(condition: unknown) {
          capturedWhere = condition;
          return {
            andWhere: async (...args: unknown[]) => {
              captured.push(args);
              return rows;
            },
          };
        },
      }),
    };
    const database = (() => fake) as unknown as knex.Knex;
    const repo = new CardGuidLedgerRepository(database);

    const identity = await repo.getUploadIdentityForOwner(7);

    expect(capturedWhere).toEqual({ owner: 7 });
    expect(captured[0]).toEqual(['block_id', 'like', 'u:%']);
    expect(identity).toEqual({
      'u:abc': {
        guid: 'guid-a',
        sourcePageId: 'hash:fp',
        contentChangedAt: 1_700_000_000,
      },
      'u:def': { guid: 'guid-b', sourcePageId: null, contentChangedAt: null },
    });
  });

  it('reissue collapses duplicate block_id entries in one batch, keeping the last', async () => {
    // A zip upload resolves each file's identity independently (DeckParser
    // runs per package), so two files that each have a card with the same
    // normalized front + type land on the same block_id here. Postgres
    // rejects an ON CONFLICT DO UPDATE that would touch one row twice in the
    // same statement (error 21000) — this collapse is what keeps that one
    // real prod crash (2026-09-25) from reaching the query.
    const calls: CapturedInsert[] = [];
    const repo = new CardGuidLedgerRepository(captureDatabase(calls));

    await repo.reissue(7, [
      { blockId: 'u:abc', sourcePageId: 'page-1', guid: 'guid-first' },
      { blockId: 'u:abc', sourcePageId: 'page-2', guid: 'guid-second' },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].rows).toEqual([
      {
        owner: 7,
        block_id: 'u:abc',
        source_page_id: 'page-2',
        guid: 'guid-second',
        content_changed_at: null,
      },
    ]);
  });

  it('record collapses duplicate block_id entries in one batch, keeping the last', async () => {
    const calls: CapturedInsert[] = [];
    const repo = new CardGuidLedgerRepository(captureDatabase(calls));

    await repo.record(7, [
      { blockId: 'block-a', guid: 'guid-first' },
      { blockId: 'block-a', guid: 'guid-second' },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].rows).toEqual([
      {
        owner: 7,
        block_id: 'block-a',
        source_page_id: null,
        guid: 'guid-second',
        content_changed_at: null,
      },
    ]);
  });

  it('record maps entries to snake_case rows and skips empty input', async () => {
    const captured: unknown[] = [];
    const fake = {
      insert(rows: unknown) {
        captured.push(rows);
        return { onConflict: () => ({ ignore: async () => undefined }) };
      },
    };
    const database = (() => fake) as unknown as knex.Knex;
    const repo = new CardGuidLedgerRepository(database);

    await repo.record(7, []);
    expect(captured).toHaveLength(0);

    await repo.record(7, [
      { blockId: 'block-a', sourcePageId: undefined, guid: 'guid-a' },
    ]);
    expect(captured[0]).toEqual([
      {
        owner: 7,
        block_id: 'block-a',
        source_page_id: null,
        guid: 'guid-a',
        content_changed_at: null,
      },
    ]);
  });
});
