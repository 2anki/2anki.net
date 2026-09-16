import knex, { Knex } from 'knex';
import { deleteDeadUploadRowsInDatabase } from './deleteDeadUploadRowsInDatabase';
import { IErrorEventRepository } from '../../../../data_layer/ErrorEventRepository';

function makeStorage(keys: string[]) {
  return {
    getContents: jest.fn().mockResolvedValue(keys.map((Key) => ({ Key }))),
  };
}

describe('deleteDeadUploadRowsInDatabase', () => {
  let db: Knex;

  async function seedUpload(id: number, key: string, owner: number) {
    await db('uploads').insert({ id, key, owner });
  }

  async function remainingKeys(): Promise<string[]> {
    const rows = await db('uploads').select('key').orderBy('key');
    return rows.map((r) => r.key as string);
  }

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('uploads', (t) => {
      t.integer('id').primary();
      t.text('key');
      t.integer('owner').notNullable();
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('deletes rows whose bucket object is gone and keeps live and reserved-prefix rows', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    await seedUpload(1, 'decks/live-1.apkg', 10);
    await seedUpload(2, 'decks/gone-1.apkg', 20);
    await seedUpload(3, 'decks/gone-2.apkg', 30);
    await seedUpload(4, 'mindmaps/reserved.png', 40);
    await seedUpload(5, 'decks/live-2.apkg', 10);

    const storage = makeStorage(['decks/live-1.apkg', 'decks/live-2.apkg']);

    await deleteDeadUploadRowsInDatabase(db, storage as never);

    expect(await remainingKeys()).toEqual([
      'decks/live-1.apkg',
      'decks/live-2.apkg',
      'mindmaps/reserved.png',
    ]);
    infoSpy.mockRestore();
  });

  it('refuses to delete any row when the bucket listing comes back empty', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await seedUpload(1, 'decks/live-1.apkg', 10);
    await seedUpload(2, 'decks/gone-1.apkg', 20);

    const storage = makeStorage([]);

    await deleteDeadUploadRowsInDatabase(db, storage as never);

    expect(await remainingKeys()).toEqual([
      'decks/gone-1.apkg',
      'decks/live-1.apkg',
    ]);
    errorSpy.mockRestore();
  });

  it('refuses to delete any row when the bucket listing hit the paging cap', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await seedUpload(1, 'decks/gone-1.apkg', 20);

    const capped = Array.from(
      { length: 100_000 },
      (_, i) => `decks/other-${i}.apkg`
    );
    const storage = makeStorage(capped);

    await deleteDeadUploadRowsInDatabase(db, storage as never);

    expect(await remainingKeys()).toEqual(['decks/gone-1.apkg']);
    errorSpy.mockRestore();
  });

  it('raises a deletion-volume alarm and deletes nothing when the dead fraction is anomalous', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    for (let i = 1; i <= 130; i++) {
      await seedUpload(i, `decks/gone-${i}.apkg`, i);
    }

    const insert = jest.fn().mockResolvedValue(undefined);
    const storage = makeStorage(['decks/unrelated-live.apkg']);

    await deleteDeadUploadRowsInDatabase(
      db,
      storage as never,
      {
        insert,
      } as unknown as IErrorEventRepository
    );

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0].source).toBe('server');
    expect(await remainingKeys()).toHaveLength(130);

    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('does not raise an alarm for a normal-volume cleanup run', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    await seedUpload(1, 'decks/gone-1.apkg', 10);
    for (let i = 2; i <= 130; i++) {
      await seedUpload(i, `decks/live-${i}.apkg`, i);
    }

    const insert = jest.fn().mockResolvedValue(undefined);
    const liveKeys = Array.from(
      { length: 129 },
      (_, i) => `decks/live-${i + 2}.apkg`
    );
    const storage = makeStorage(liveKeys);

    await deleteDeadUploadRowsInDatabase(
      db,
      storage as never,
      {
        insert,
      } as unknown as IErrorEventRepository
    );

    expect(insert).not.toHaveBeenCalled();
    expect(await remainingKeys()).not.toContain('decks/gone-1.apkg');
    expect(await remainingKeys()).toHaveLength(129);

    infoSpy.mockRestore();
  });
});
