import knex, { type Knex } from 'knex';

import { AiCardFingerprintRepository } from './AiCardFingerprintRepository';

describe('AiCardFingerprintRepository generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new AiCardFingerprintRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('reads the most recent fingerprints for one owner, newest first', () => {
    const { sql, bindings } = repository.buildRecentQuery(42, 5000).toSQL();

    expect(sql).toBe(
      'select "fingerprint" from "ai_card_fingerprints" where "owner" = ? ' +
        'order by "created_at" desc limit ?'
    );
    expect(bindings).toEqual([42, 5000]);
  });

  it('inserts rows and ignores duplicates on the owner+fingerprint key', () => {
    const { sql, bindings } = repository
      .buildInsertQuery(42, ['aaa', 'bbb'])
      .toSQL();

    expect(sql).toBe(
      'insert into "ai_card_fingerprints" ("fingerprint", "owner") ' +
        'values (?, ?), (?, ?) ' +
        'on conflict ("owner", "fingerprint") do nothing'
    );
    expect(bindings).toEqual(['aaa', 42, 'bbb', 42]);
  });
});

describe('AiCardFingerprintRepository behavior', () => {
  function fakeDatabase(recentRows: Array<{ fingerprint: string }>) {
    const insertedBatches: string[][] = [];
    const builder = {
      select: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => Promise.resolve(recentRows),
      insert: (rows: Array<{ fingerprint: string }>) => {
        insertedBatches.push(rows.map((r) => r.fingerprint));
        return builder;
      },
      onConflict: () => builder,
      ignore: () => Promise.resolve(),
    };
    const database = (() => builder) as unknown as Knex;
    return { database, insertedBatches };
  }

  it('returns the fingerprint column values in order', async () => {
    const { database } = fakeDatabase([
      { fingerprint: 'a' },
      { fingerprint: 'b' },
    ]);
    const repository = new AiCardFingerprintRepository(database);

    expect(await repository.getRecentForOwner(7, 10)).toEqual(['a', 'b']);
  });

  it('deduplicates fingerprints before insert', async () => {
    const { database, insertedBatches } = fakeDatabase([]);
    const repository = new AiCardFingerprintRepository(database);

    await repository.record(7, ['x', 'x', 'y', 'x']);

    expect(insertedBatches).toEqual([['x', 'y']]);
  });

  it('writes nothing when there are no fingerprints', async () => {
    const { database, insertedBatches } = fakeDatabase([]);
    const repository = new AiCardFingerprintRepository(database);

    await repository.record(7, []);

    expect(insertedBatches).toEqual([]);
  });
});
