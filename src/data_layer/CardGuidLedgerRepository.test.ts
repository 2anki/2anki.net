import knex from 'knex';
import { CardGuidLedgerRepository } from './CardGuidLedgerRepository';

interface CapturedInsert {
  rows: Array<Record<string, unknown>>;
  conflictColumns?: string[];
  ignored: boolean;
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

  it('getAllForOwner returns a block_id to guid record', async () => {
    const rows = [
      { block_id: 'block-a', guid: 'guid-a' },
      { block_id: 'block-b', guid: 'guid-b' },
    ];
    const fake = {
      select: () => ({ where: async () => rows }),
    };
    const database = (() => fake) as unknown as knex.Knex;
    const repo = new CardGuidLedgerRepository(database);

    const known = await repo.getAllForOwner(7);

    expect(known).toEqual({ 'block-a': 'guid-a', 'block-b': 'guid-b' });
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
      { owner: 7, block_id: 'block-a', source_page_id: null, guid: 'guid-a' },
    ]);
  });
});
