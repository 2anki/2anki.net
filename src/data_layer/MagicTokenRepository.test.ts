import knex, { type Knex } from 'knex';

import {
  InMemoryMagicTokenRepository,
  MagicTokenRepository,
} from './MagicTokenRepository';

describe('MagicTokenRepository', () => {
  let db: Knex;
  let repo: MagicTokenRepository;
  const inFifteenMinutes = () => new Date(Date.now() + 15 * 60 * 1000);

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('magic_tokens', (t) => {
      t.increments('id');
      t.string('token', 128).unique();
      t.integer('owner');
      t.string('purpose', 20);
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('expires_at');
      t.timestamp('used_at').nullable();
    });
    repo = new MagicTokenRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('consumeValidToken', () => {
    it('spends a live token once and returns its owner and purpose', async () => {
      await repo.create('live', 7, 'login', inFifteenMinutes());

      const first = await repo.consumeValidToken('live');
      const second = await repo.consumeValidToken('live');

      expect(first).toMatchObject({
        token: 'live',
        owner: 7,
        purpose: 'login',
      });
      expect(first?.used_at).not.toBeNull();
      expect(second).toBeNull();
    });

    it('spends exactly one of two concurrent attempts', async () => {
      await repo.create('race', 7, 'login', inFifteenMinutes());

      const results = await Promise.all([
        repo.consumeValidToken('race'),
        repo.consumeValidToken('race'),
      ]);

      expect(results.filter((r) => r != null)).toHaveLength(1);
    });

    it('refuses an expired token and leaves it unspent', async () => {
      await repo.create('old', 7, 'login', new Date(Date.now() - 1000));

      expect(await repo.consumeValidToken('old')).toBeNull();
      expect((await repo.findByToken('old'))?.used_at).toBeNull();
    });

    it('leaves an email-verification token unspent', async () => {
      await repo.create('verify', 7, 'verify_email', inFifteenMinutes());

      expect(await repo.consumeValidToken('verify')).toBeNull();
      expect((await repo.findByToken('verify'))?.used_at).toBeNull();
    });

    it('updates only an unspent, unexpired sign-in row', () => {
      const at = new Date('2026-11-17T12:00:00Z');
      const pg = knex({ client: 'pg' });
      const query = new MagicTokenRepository(pg)
        .consumeQuery('tok', at)
        .toSQL();

      expect(query.sql).toBe(
        'update "magic_tokens" set "used_at" = ? where "token" = ? and "used_at" is null and "expires_at" > ? and "purpose" in (?, ?)'
      );
      expect(query.bindings).toEqual([
        at,
        'tok',
        at,
        'login',
        'password_reset',
      ]);
    });
  });

  describe('findByToken', () => {
    it('returns a spent token with its owner', async () => {
      await repo.create('spent', 9, 'login', inFifteenMinutes());
      await repo.consumeValidToken('spent');

      expect(await repo.findByToken('spent')).toMatchObject({
        owner: 9,
        purpose: 'login',
      });
    });

    it('returns null for an unknown token', async () => {
      expect(await repo.findByToken('nope')).toBeNull();
    });
  });
});

describe('InMemoryMagicTokenRepository', () => {
  const NOW = new Date('2026-05-12T12:00:00Z');
  const FIFTEEN_MINUTES_LATER = new Date('2026-05-12T12:15:00Z');
  const ONE_MINUTE_LATER = new Date('2026-05-12T12:01:00Z');

  function buildRepo(): InMemoryMagicTokenRepository {
    const repo = new InMemoryMagicTokenRepository();
    repo.setNow(NOW);
    return repo;
  }

  describe('create and findValidToken', () => {
    it('stores a token and retrieves it when valid', async () => {
      const repo = buildRepo();
      await repo.create('abc123', 1, 'login', FIFTEEN_MINUTES_LATER);

      const result = await repo.findValidToken('abc123');

      expect(result).toMatchObject({
        token: 'abc123',
        owner: 1,
        purpose: 'login',
        used_at: null,
      });
    });

    it('returns null for a non-existent token', async () => {
      const repo = buildRepo();

      const result = await repo.findValidToken('does-not-exist');

      expect(result).toBeNull();
    });

    it('returns null for an expired token', async () => {
      const repo = buildRepo();
      const alreadyExpired = new Date('2026-05-12T11:00:00Z');
      await repo.create('expired-tok', 1, 'login', alreadyExpired);

      const result = await repo.findValidToken('expired-tok');

      expect(result).toBeNull();
    });
  });

  describe('markUsed', () => {
    it('marks a token as used so it cannot be found again', async () => {
      const repo = buildRepo();
      await repo.create('use-me', 2, 'password_reset', FIFTEEN_MINUTES_LATER);

      await repo.markUsed('use-me');

      const result = await repo.findValidToken('use-me');
      expect(result).toBeNull();
    });
  });

  describe('countRecentByOwner', () => {
    it('counts tokens created after the given date for the owner', async () => {
      const repo = buildRepo();
      await repo.create('t1', 5, 'login', FIFTEEN_MINUTES_LATER);
      await repo.create('t2', 5, 'login', FIFTEEN_MINUTES_LATER);
      await repo.create('t3', 99, 'login', FIFTEEN_MINUTES_LATER);

      const count = await repo.countRecentByOwner(
        5,
        new Date('2026-05-12T11:00:00Z')
      );

      expect(count).toBe(2);
    });

    it('excludes tokens created before the since cutoff', async () => {
      const repo = buildRepo();
      repo.setNow(new Date('2026-05-12T10:00:00Z'));
      await repo.create('old-tok', 5, 'login', FIFTEEN_MINUTES_LATER);

      repo.setNow(NOW);
      await repo.create('new-tok', 5, 'login', FIFTEEN_MINUTES_LATER);

      const count = await repo.countRecentByOwner(
        5,
        new Date('2026-05-12T11:00:00Z')
      );

      expect(count).toBe(1);
    });

    it('returns zero when no tokens match', async () => {
      const repo = buildRepo();

      const count = await repo.countRecentByOwner(
        42,
        new Date('2026-05-12T11:00:00Z')
      );

      expect(count).toBe(0);
    });
  });

  describe('deleteExpired', () => {
    it('removes expired tokens and returns the count', async () => {
      const repo = buildRepo();
      const alreadyExpired = new Date('2026-05-12T11:00:00Z');
      await repo.create('expired', 1, 'login', alreadyExpired);
      await repo.create('valid', 1, 'login', FIFTEEN_MINUTES_LATER);

      const deleted = await repo.deleteExpired();

      expect(deleted).toBe(1);
      const stillValid = await repo.findValidToken('valid');
      expect(stillValid).not.toBeNull();
    });

    it('returns zero when nothing is expired', async () => {
      const repo = buildRepo();
      await repo.create('fresh', 1, 'login', FIFTEEN_MINUTES_LATER);

      const deleted = await repo.deleteExpired();

      expect(deleted).toBe(0);
    });
  });
});
