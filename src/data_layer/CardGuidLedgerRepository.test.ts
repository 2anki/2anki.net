import knex from 'knex';
import { CardGuidLedgerRepository } from './CardGuidLedgerRepository';

describe('CardGuidLedgerRepository SQL generation', () => {
  const db = knex({ client: 'pg' });

  it('record inserts with a do-nothing conflict guard on (owner, block_id)', () => {
    const qb = db('card_guids')
      .insert([
        {
          owner: 7,
          block_id: 'block-a',
          source_page_id: 'page-1',
          guid: 'guid-a',
        },
      ])
      .onConflict(['owner', 'block_id'])
      .ignore();
    const sql = qb.toString();
    expect(sql).toContain('insert into "card_guids"');
    expect(sql).toContain('on conflict ("owner", "block_id") do nothing');
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
