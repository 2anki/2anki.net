import knex, { Knex } from 'knex';
import {
  InMemoryReEngagementRepository,
  ReEngagementRepository,
} from './ReEngagementRepository';

describe('InMemoryReEngagementRepository', () => {
  describe('hasBeenSent', () => {
    it('returns false when no email has been sent to the user', async () => {
      const repo = new InMemoryReEngagementRepository();

      const result = await repo.hasBeenSent(42);

      expect(result).toBe(false);
    });

    it('returns true after recordSend is called for the user', async () => {
      const repo = new InMemoryReEngagementRepository();
      await repo.recordSend(42, 'abc123');

      const result = await repo.hasBeenSent(42);

      expect(result).toBe(true);
    });
  });

  describe('recordSend', () => {
    it('returns a numeric email id', async () => {
      const repo = new InMemoryReEngagementRepository();

      const id = await repo.recordSend(1, 'token-one');

      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });

    it('returns incrementing ids for successive calls', async () => {
      const repo = new InMemoryReEngagementRepository();

      const id1 = await repo.recordSend(1, 'tok1');
      const id2 = await repo.recordSend(2, 'tok2');

      expect(id2).toBeGreaterThan(id1);
    });
  });

  describe('findByToken', () => {
    it('returns null when token does not exist', async () => {
      const repo = new InMemoryReEngagementRepository();

      const result = await repo.findByToken('ghost');

      expect(result).toBeNull();
    });

    it('returns id and userId when token exists', async () => {
      const repo = new InMemoryReEngagementRepository();
      const emailId = await repo.recordSend(7, 'my-token');

      const result = await repo.findByToken('my-token');

      expect(result).toEqual({ id: emailId, userId: 7 });
    });
  });

  describe('saveResponse', () => {
    it('stores the response linked to the email id', async () => {
      const repo = new InMemoryReEngagementRepository();
      const emailId = await repo.recordSend(3, 'resp-token');

      await repo.saveResponse(emailId, 'too_complex', 'notion', 'Hard to use');

      const responses = repo.getResponses();
      expect(responses).toHaveLength(1);
      expect(responses[0]).toMatchObject({
        emailId,
        stoppedReason: 'too_complex',
        contentType: 'notion',
        comment: 'Hard to use',
      });
    });

    it('stores null comment when comment is null', async () => {
      const repo = new InMemoryReEngagementRepository();
      const emailId = await repo.recordSend(4, 'null-comment-token');

      await repo.saveResponse(emailId, 'forgot', 'upload', null);

      expect(repo.getResponses()[0].comment).toBeNull();
    });
  });

  describe('getUsersToEmail', () => {
    it('returns seeded users that have not been sent an email', async () => {
      const repo = new InMemoryReEngagementRepository();
      repo.seedUsers([
        { id: 10, name: 'Alice', email: 'alice@example.com' },
        { id: 11, name: 'Bob', email: 'bob@example.com' },
      ]);

      const users = await repo.getUsersToEmail();

      expect(users).toHaveLength(2);
    });

    it('excludes users who have already received an email', async () => {
      const repo = new InMemoryReEngagementRepository();
      repo.seedUsers([
        { id: 10, name: 'Alice', email: 'alice@example.com' },
        { id: 11, name: 'Bob', email: 'bob@example.com' },
      ]);
      await repo.recordSend(10, 'alice-token');

      const users = await repo.getUsersToEmail();

      expect(users).toHaveLength(1);
      expect(users[0].id).toBe(11);
    });

    it('returns empty array when all users have been sent an email', async () => {
      const repo = new InMemoryReEngagementRepository();
      repo.seedUsers([
        { id: 5, name: 'Charlie', email: 'charlie@example.com' },
      ]);
      await repo.recordSend(5, 'charlie-token');

      const users = await repo.getUsersToEmail();

      expect(users).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('resets all state', async () => {
      const repo = new InMemoryReEngagementRepository();
      repo.seedUsers([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
      await repo.recordSend(1, 'tok');
      repo.clear();

      expect(await repo.hasBeenSent(1)).toBe(false);
      expect(await repo.getUsersToEmail()).toHaveLength(0);
    });
  });
});

describe('ReEngagementRepository.findByToken — abandoned checkout path', () => {
  let database: Knex;
  let repo: ReEngagementRepository;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await database.schema.createTable('re_engagement_emails', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.text('token').unique();
    });

    await database.schema.createTable('inactivity_emails', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.text('token').unique();
    });

    await database.schema.createTable('price_lock_in_emails', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.text('token').unique();
    });

    await database.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable().unique();
      t.text('name').notNullable().defaultTo('');
    });

    await database.schema.createTable(
      'abandoned_checkout_recovery_emails',
      (t) => {
        t.text('session_id').primary();
        t.text('user_email').notNullable();
        t.timestamp('sent_at').notNullable().defaultTo(database.fn.now());
        t.string('token', 128).nullable().unique();
      }
    );

    await database.schema.createTable('pass_winback_notifications', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.string('campaign').notNullable();
      t.string('token').notNullable();
    });

    repo = new ReEngagementRepository(database);
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('returns null when token is not in any table', async () => {
    const result = await repo.findByToken('ghost-token');
    expect(result).toBeNull();
  });

  it('resolves abandoned checkout token to the correct userId via email join', async () => {
    const [user] = await database('users')
      .insert({ email: 'buyer@example.com', name: 'Buyer' })
      .returning('id');
    const userId = typeof user === 'object' ? user.id : user;

    await database('abandoned_checkout_recovery_emails').insert({
      session_id: 'cs_test_xyz',
      user_email: 'buyer@example.com',
      token: 'unsubscribe-tok',
    });

    const result = await repo.findByToken('unsubscribe-tok');

    expect(result).not.toBeNull();
    expect(result?.userId).toBe(userId);
  });

  it('returns null when token exists in abandoned checkout but user email has no matching user', async () => {
    await database('abandoned_checkout_recovery_emails').insert({
      session_id: 'cs_orphan',
      user_email: 'ghost@example.com',
      token: 'orphan-tok',
    });

    const result = await repo.findByToken('orphan-tok');

    expect(result).toBeNull();
  });

  it('resolves an inactivity warning token to its userId', async () => {
    await database('inactivity_emails').insert({
      user_id: 42,
      token: 'inactivity-tok',
    });

    const result = await repo.findByToken('inactivity-tok');

    expect(result).toEqual({ id: expect.any(Number), userId: 42 });
  });

  it('resolves a pass-ending token to its userId', async () => {
    await database('pass_winback_notifications').insert({
      user_id: 61,
      campaign: 'pass_ending:7',
      token: 'pass-ending-tok',
    });

    const result = await repo.findByToken('pass-ending-tok');

    expect(result).toEqual({ id: expect.any(Number), userId: 61 });
  });

  it('resolves a price lock-in token to its userId', async () => {
    await database('price_lock_in_emails').insert({
      user_id: 99,
      token: 'price-lock-tok',
    });

    const result = await repo.findByToken('price-lock-tok');

    expect(result).toEqual({ id: expect.any(Number), userId: 99 });
  });

  it('resolves a pass win-back token to its userId', async () => {
    await database('pass_winback_notifications').insert({
      user_id: 55,
      campaign: 'winback-2026-fall',
      token: 'winback-tok',
    });

    const result = await repo.findByToken('winback-tok');

    expect(result).toEqual({ id: expect.any(Number), userId: 55 });
  });

  it('does not find abandoned checkout token when searching other tables', async () => {
    await database('users').insert({
      email: 'buyer2@example.com',
      name: 'Buyer2',
    });
    await database('abandoned_checkout_recovery_emails').insert({
      session_id: 'cs_other',
      user_email: 'buyer2@example.com',
      token: 'checkout-only-tok',
    });

    const reEngResult = await database('re_engagement_emails')
      .where({ token: 'checkout-only-tok' })
      .first();
    expect(reEngResult).toBeUndefined();

    const repoResult = await repo.findByToken('checkout-only-tok');
    expect(repoResult).not.toBeNull();
  });
});
