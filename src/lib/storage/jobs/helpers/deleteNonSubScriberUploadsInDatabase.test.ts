import knex, { Knex } from 'knex';
import { deleteNonSubScriberUploadsInDatabase } from './deleteNonSubScriberUploadsInDatabase';
import { IErrorEventRepository } from '../../../../data_layer/ErrorEventRepository';

function makeDb(uploadsToDelete: { key: string }[] = []) {
  const deleteMock = jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue(1),
  });
  const countMock = jest.fn().mockReturnValue({
    first: jest.fn().mockResolvedValue({ count: uploadsToDelete.length }),
  });
  const revokeUpdateMock = jest.fn().mockResolvedValue(1);
  const whereMock = jest.fn().mockReturnValue({
    whereNull: jest.fn().mockReturnValue({ update: revokeUpdateMock }),
  });
  const db = {
    raw: jest.fn().mockResolvedValue({ rows: uploadsToDelete }),
    uploads: jest.fn(),
    fn: { now: jest.fn().mockReturnValue('now()') },
  } as unknown;

  const dbFn = jest.fn().mockReturnValue({
    delete: deleteMock,
    count: countMock,
    where: whereMock,
  });
  Object.assign(dbFn, db);

  return { dbFn: dbFn as any, deleteMock, revokeUpdateMock };
}

function makeStorage(deleteResult = true) {
  return { delete: jest.fn().mockResolvedValue(deleteResult) };
}

describe('deleteNonSubScriberUploadsInDatabase', () => {
  it('does nothing when no uploads are returned', async () => {
    const { dbFn } = makeDb([]);
    const storage = makeStorage();

    await deleteNonSubScriberUploadsInDatabase(dbFn, storage as any);

    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('deletes uploads that are not pinned by an active share', async () => {
    const { dbFn, revokeUpdateMock } = makeDb([{ key: 'unpinned.apkg' }]);
    const storage = makeStorage();

    await deleteNonSubScriberUploadsInDatabase(dbFn, storage as any);

    expect(storage.delete).toHaveBeenCalledWith('unpinned.apkg');
    expect(revokeUpdateMock).toHaveBeenCalledWith({
      revoked_at: expect.anything(),
    });
  });

  it('passes the NOT EXISTS subquery filtering shared uploads to db.raw', async () => {
    const { dbFn } = makeDb([]);
    const storage = makeStorage();

    await deleteNonSubScriberUploadsInDatabase(dbFn, storage as any);

    const [rawCall, rawBindings] = (dbFn.raw as jest.Mock).mock.calls[0] as [
      string,
      unknown,
    ];
    expect(rawCall).toContain('deck_shares');
    expect(rawCall).toContain('revoked_at IS NULL');
    expect(rawCall).toContain('COALESCE(ds.last_viewed_at, ds.created_at) > ?');
    expect(rawBindings).toEqual([expect.any(String)]);
  });

  it('exempts holders of an active user pass from upload deletion', async () => {
    const { dbFn } = makeDb([]);
    const storage = makeStorage();

    await deleteNonSubScriberUploadsInDatabase(dbFn, storage as any);

    const rawCall = (dbFn.raw as jest.Mock).mock.calls[0][0] as string;
    expect(rawCall).toContain('user_passes');
    expect(rawCall).toContain('pass.user_id = u.id');
    expect(rawCall).toContain('pass.expires_at > now()');
  });
});

// End-to-end guard for the Oct-2024 subscriber-data-deletion incident
// (Documentation/post-mortems/2024-10-subscriber-data-deletion.md). This runs
// the REAL raw cleanup query against a real database and asserts that no active
// subscriber, linked-email subscriber, lifetime, pass holder, or shared upload
// is ever swept — only genuine non-subscribers are. The mocked-db tests above
// only inspect the query string; they never execute the SQL, so an incorrect
// predicate would pass them and re-open the highest-revenue-impact regression in
// the repo's history. This block executes it.
describe('deleteNonSubScriberUploadsInDatabase — cleanup-vs-subscriber e2e', () => {
  const FUTURE = '2099-01-01T00:00:00.000Z';
  const PAST = '2000-01-01T00:00:00.000Z';

  let db: Knex;

  // The pg driver returns raw() results as { rows }, better-sqlite3 returns the
  // array directly. Reshape only raw() so the unmodified production function —
  // which reads query.rows — runs against sqlite exactly as it does in prod.
  function withPgRawShape(real: Knex): Knex {
    return new Proxy(real, {
      apply: (target, _thisArg, args: unknown[]) =>
        (target as unknown as (...a: unknown[]) => unknown)(...args),
      get: (target, prop, receiver) => {
        if (prop === 'raw') {
          return async (...a: unknown[]) => {
            const res = await (
              target as unknown as {
                raw: (...x: unknown[]) => Promise<unknown>;
              }
            ).raw(...a);
            return Array.isArray(res) ? { rows: res } : res;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Knex;
  }

  async function seedUserWithUpload(
    id: number,
    email: string,
    patreon: boolean,
    uploadKey: string
  ) {
    await db('users').insert({ id, email, patreon });
    await db('uploads').insert({ key: uploadKey, owner: id });
  }

  async function remainingUploadKeys(): Promise<string[]> {
    const rows = await db('uploads').select('key').orderBy('key');
    return rows.map((r) => r.key as string);
  }

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: {
        // The production query uses Postgres now(); register an equivalent SQL
        // function so the exact raw query executes unchanged on sqlite. ISO-8601
        // strings compare lexicographically, matching timestamp ordering.
        afterCreate: (
          conn: { function: (name: string, fn: () => string) => void },
          done: (err: Error | null, conn: unknown) => void
        ) => {
          conn.function('now', () => new Date().toISOString());
          done(null, conn);
        },
      },
    });

    await db.schema.createTable('users', (t) => {
      t.integer('id').primary();
      t.text('email').notNullable().unique();
      t.boolean('patreon').notNullable().defaultTo(false);
    });
    await db.schema.createTable('uploads', (t) => {
      t.text('key').primary();
      t.integer('owner').notNullable();
    });
    await db.schema.createTable('subscriptions', (t) => {
      t.increments('id').primary();
      t.text('email').nullable();
      t.text('linked_email').nullable();
      t.boolean('active').nullable();
    });
    await db.schema.createTable('subscriptions_developer', (t) => {
      t.increments('id');
      t.string('stripe_subscription_id');
      t.integer('user_id');
      t.string('email');
      t.string('stripe_product_id');
      t.boolean('active');
    });
    await db.schema.createTable('user_passes', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.text('expires_at').notNullable();
    });
    await db.schema.createTable('deck_shares', (t) => {
      t.increments('id').primary();
      t.text('upload_key').notNullable();
      t.text('revoked_at').nullable();
      // Seeded as explicit 24-char ISO strings in every test. sqlite's
      // CURRENT_TIMESTAMP emits 'YYYY-MM-DD HH:MM:SS' (space, no Z) which does
      // NOT compare lexicographically against the ISO cutoff binding.
      t.text('created_at').nullable();
      t.text('last_viewed_at').nullable();
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('deletes only genuine non-subscriber uploads and spares every paid signal', async () => {
    // 1: free non-subscriber — the only one that should be swept
    await seedUserWithUpload(1, 'free@example.com', false, 'free.apkg');
    // 2: lifetime (patreon) — spared
    await seedUserWithUpload(2, 'life@example.com', true, 'life.apkg');
    // 3: active Stripe sub matched on subscriptions.email — spared
    await seedUserWithUpload(3, 'stripe@example.com', false, 'stripe.apkg');
    await db('subscriptions').insert({
      email: 'stripe@example.com',
      active: true,
    });
    // 4: active sub matched via linked_email — spared
    await seedUserWithUpload(4, 'linked@example.com', false, 'linked.apkg');
    await db('subscriptions').insert({
      email: 'billing@example.com',
      linked_email: 'linked@example.com',
      active: true,
    });
    // 5: active pass holder — spared
    await seedUserWithUpload(5, 'pass@example.com', false, 'pass.apkg');
    await db('user_passes').insert({ user_id: 5, expires_at: FUTURE });
    // 6: expired pass, no other signal — swept
    await seedUserWithUpload(6, 'exp@example.com', false, 'expired.apkg');
    await db('user_passes').insert({ user_id: 6, expires_at: PAST });
    // 7: non-subscriber but upload pinned by a fresh unrevoked share — spared
    await seedUserWithUpload(7, 'shared@example.com', false, 'shared.apkg');
    await db('deck_shares').insert({
      upload_key: 'shared.apkg',
      revoked_at: null,
      created_at: new Date().toISOString(),
    });
    // 8: cancelled subscriber (active = false) — swept
    await seedUserWithUpload(
      8,
      'cancelled@example.com',
      false,
      'cancelled.apkg'
    );
    await db('subscriptions').insert({
      email: 'cancelled@example.com',
      active: false,
    });

    const deleted: string[] = [];
    const storage = {
      delete: jest.fn(async (key: string) => {
        deleted.push(key);
      }),
    };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never
    );

    expect(deleted.sort()).toEqual(
      ['cancelled.apkg', 'expired.apkg', 'free.apkg'].sort()
    );
    expect(await remainingUploadKeys()).toEqual(
      [
        'life.apkg',
        'linked.apkg',
        'pass.apkg',
        'shared.apkg',
        'stripe.apkg',
      ].sort()
    );
  });

  it('spares a subscriber even when a stale revoked share also exists', async () => {
    await seedUserWithUpload(1, 'sub@example.com', false, 'sub.apkg');
    await db('subscriptions').insert({
      email: 'sub@example.com',
      active: true,
    });
    await db('deck_shares').insert({
      upload_key: 'sub.apkg',
      revoked_at: PAST,
    });

    const storage = { delete: jest.fn() };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never
    );

    expect(storage.delete).not.toHaveBeenCalled();
    expect(await remainingUploadKeys()).toEqual(['sub.apkg']);
  });

  it('sweeps an upload pinned only by a share idle past the TTL and revokes the share', async () => {
    await seedUserWithUpload(1, 'stale@example.com', false, 'stale.apkg');
    await db('deck_shares').insert({
      upload_key: 'stale.apkg',
      revoked_at: null,
      created_at: PAST,
      last_viewed_at: PAST,
    });

    const storage = { delete: jest.fn() };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never
    );

    expect(storage.delete).toHaveBeenCalledWith('stale.apkg');
    expect(await remainingUploadKeys()).toEqual([]);
    const share = await db('deck_shares').first();
    expect(share.revoked_at).not.toBeNull();
  });

  it('spares an old share that was viewed within the TTL window', async () => {
    await seedUserWithUpload(1, 'active@example.com', false, 'active.apkg');
    await db('deck_shares').insert({
      upload_key: 'active.apkg',
      revoked_at: null,
      created_at: PAST,
      last_viewed_at: new Date().toISOString(),
    });

    const storage = { delete: jest.fn() };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never
    );

    expect(storage.delete).not.toHaveBeenCalled();
    expect(await remainingUploadKeys()).toEqual(['active.apkg']);
  });

  it('spares a freshly created share that has never been viewed', async () => {
    await seedUserWithUpload(1, 'fresh@example.com', false, 'fresh.apkg');
    await db('deck_shares').insert({
      upload_key: 'fresh.apkg',
      revoked_at: null,
      created_at: new Date().toISOString(),
      last_viewed_at: null,
    });

    const storage = { delete: jest.fn() };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never
    );

    expect(storage.delete).not.toHaveBeenCalled();
    expect(await remainingUploadKeys()).toEqual(['fresh.apkg']);
  });

  it('sweeps a never-viewed share once its creation date passes the TTL', async () => {
    await seedUserWithUpload(1, 'aged@example.com', false, 'aged.apkg');
    await db('deck_shares').insert({
      upload_key: 'aged.apkg',
      revoked_at: null,
      created_at: PAST,
      last_viewed_at: null,
    });

    const storage = { delete: jest.fn() };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never
    );

    expect(storage.delete).toHaveBeenCalledWith('aged.apkg');
    expect(await remainingUploadKeys()).toEqual([]);
  });

  it('spares a customer whose only paid subscription is a developer tier', async () => {
    // Developer tiers live in subscriptions_developer, not subscriptions, so
    // this customer has no row in the table the subscriber predicate reads.
    // Without the second clause they read as a free user and their uploads are
    // deleted from the bucket irreversibly.
    await seedUserWithUpload(1, 'dev@example.com', false, 'dev.apkg');
    await db('subscriptions_developer').insert({
      stripe_subscription_id: 'sub_dev_1',
      user_id: 1,
      email: 'dev@example.com',
      stripe_product_id: 'prod_growth',
      active: true,
    });

    const storage = { delete: jest.fn() };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never
    );

    expect(storage.delete).not.toHaveBeenCalled();
    expect(await remainingUploadKeys()).toEqual(['dev.apkg']);
  });

  it('still sweeps a user whose developer tier is no longer active', async () => {
    await seedUserWithUpload(1, 'lapsed@example.com', false, 'lapsed.apkg');
    await db('subscriptions_developer').insert({
      stripe_subscription_id: 'sub_dev_2',
      user_id: 1,
      email: 'lapsed@example.com',
      stripe_product_id: 'prod_growth',
      active: false,
    });

    const storage = { delete: jest.fn() };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never
    );

    expect(await remainingUploadKeys()).toEqual([]);
  });

  it('spares a subscriber who also holds a stale cancelled subscription row', async () => {
    await seedUserWithUpload(1, 'dual@example.com', false, 'dual.apkg');
    await db('subscriptions').insert({
      email: 'dual@example.com',
      active: false,
    });
    await db('subscriptions').insert({
      email: 'billing@example.com',
      linked_email: 'dual@example.com',
      active: true,
    });

    const storage = { delete: jest.fn() };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never
    );

    expect(storage.delete).not.toHaveBeenCalled();
    expect(await remainingUploadKeys()).toEqual(['dual.apkg']);
  });

  it('spares an active subscriber whose account email differs in case', async () => {
    await seedUserWithUpload(1, 'Mixed.Case@Example.com', false, 'mixed.apkg');
    await db('subscriptions').insert({
      email: 'mixed.case@example.com',
      active: true,
    });

    const storage = { delete: jest.fn() };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never
    );

    expect(storage.delete).not.toHaveBeenCalled();
    expect(await remainingUploadKeys()).toEqual(['mixed.apkg']);
  });

  it('sweeps a non-subscriber only once when several cancelled rows match', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    await seedUserWithUpload(1, 'lapsed@example.com', false, 'lapsed.apkg');
    await db('subscriptions').insert({
      email: 'lapsed@example.com',
      active: false,
    });
    await db('subscriptions').insert({
      email: 'old-billing@example.com',
      linked_email: 'lapsed@example.com',
      active: false,
    });

    const storage = { delete: jest.fn() };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never
    );

    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(await remainingUploadKeys()).toEqual([]);

    infoSpy.mockRestore();
  });

  it('raises a deletion-volume alarm when a run sweeps an anomalous fraction of the uploads table', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    for (let i = 1; i <= 130; i++) {
      await seedUserWithUpload(
        i,
        `free-${i}@example.com`,
        false,
        `free-${i}.apkg`
      );
    }

    const insert = jest.fn().mockResolvedValue(undefined);
    const storage = { delete: jest.fn() };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never,
      { insert } as unknown as IErrorEventRepository
    );

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0].source).toBe('server');
    expect(storage.delete).toHaveBeenCalledTimes(130);
    expect(await remainingUploadKeys()).toEqual([]);

    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('does not raise an alarm for a normal-volume cleanup run', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    for (let i = 1; i <= 5; i++) {
      await seedUserWithUpload(
        i,
        `free-${i}@example.com`,
        false,
        `free-${i}.apkg`
      );
    }
    for (let i = 100; i < 225; i++) {
      await seedUserWithUpload(
        i,
        `sub-${i}@example.com`,
        false,
        `sub-${i}.apkg`
      );
      await db('subscriptions').insert({
        email: `sub-${i}@example.com`,
        active: true,
      });
    }

    const insert = jest.fn().mockResolvedValue(undefined);
    const storage = { delete: jest.fn() };

    await deleteNonSubScriberUploadsInDatabase(
      withPgRawShape(db),
      storage as never,
      { insert } as unknown as IErrorEventRepository
    );

    expect(insert).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledTimes(5);

    infoSpy.mockRestore();
  });
});
