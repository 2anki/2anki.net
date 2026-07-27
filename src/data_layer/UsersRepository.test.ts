import Knex from 'knex';
import KnexConfig from '../KnexConfig';
import UsersRepository from './UsersRepository';
import { isNewMonth } from '../lib/User/isNewMonth';
import { startOfMonthUtc } from '../lib/User/startOfMonthUtc';

function buildKnexMock() {
  const updateSpy = jest.fn().mockResolvedValue(1);
  const whereRawSpy = jest.fn().mockReturnValue({ update: updateSpy });
  const whereSpy = jest.fn().mockReturnValue({ update: updateSpy });
  const tableBuilder = { whereRaw: whereRawSpy, where: whereSpy };
  const knex = jest
    .fn()
    .mockReturnValue(tableBuilder) as unknown as jest.Mock & {
    whereRawSpy: jest.Mock;
    whereSpy: jest.Mock;
    updateSpy: jest.Mock;
  };
  knex.whereRawSpy = whereRawSpy;
  knex.whereSpy = whereSpy;
  knex.updateSpy = updateSpy;
  return knex;
}

const SAMPLE_HASH = 'hashed-pw';

describe('UsersRepository.createUser', () => {
  it('persists signup_origin when provided', async () => {
    const insertSpy = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([{ id: 1 }]),
    });
    const tableBuilder = { insert: insertSpy };
    const knex = jest.fn().mockReturnValue(tableBuilder);
    const repo = new UsersRepository(knex as any);

    await repo.createUser(
      'al',
      SAMPLE_HASH,
      'al@example.com',
      '/notion-to-anki'
    );

    expect(insertSpy).toHaveBeenCalledWith({
      name: 'al',
      password: SAMPLE_HASH,
      email: 'al@example.com',
      signup_origin: '/notion-to-anki',
    });
  });

  it('defaults signup_origin to null when the caller omits it', async () => {
    const insertSpy = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([{ id: 1 }]),
    });
    const tableBuilder = { insert: insertSpy };
    const knex = jest.fn().mockReturnValue(tableBuilder);
    const repo = new UsersRepository(knex as any);

    await repo.createUser('al', SAMPLE_HASH, 'al@example.com');

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ signup_origin: null })
    );
  });
});

describe('UsersRepository.getByEmail', () => {
  it('uses LOWER(TRIM(email)) so mixed-case stored emails still match', async () => {
    const firstSpy = jest
      .fn()
      .mockResolvedValue({ id: 1, email: 'user@example.com' });
    const whereRawSpy = jest.fn().mockReturnValue({ first: firstSpy });
    const knex = jest
      .fn()
      .mockReturnValue({ whereRaw: whereRawSpy }) as unknown as jest.Mock;
    const repo = new UsersRepository(knex as any);

    await repo.getByEmail('  User@Example.COM  ');

    expect(whereRawSpy).toHaveBeenCalledWith('LOWER(TRIM(email)) = LOWER(?)', [
      '  User@Example.COM  '.trim(),
    ]);
  });
});

describe('UsersRepository.getLanguageByEmail', () => {
  function buildLanguageKnex(row: { language: string | null } | undefined) {
    const firstSpy = jest.fn().mockResolvedValue(row);
    const selectSpy = jest.fn().mockReturnValue({ first: firstSpy });
    const whereRawSpy = jest.fn().mockReturnValue({ select: selectSpy });
    const knex = jest
      .fn()
      .mockReturnValue({ whereRaw: whereRawSpy }) as unknown as jest.Mock;
    return { knex, whereRawSpy };
  }

  it('matches the email case-insensitively and returns the stored language', async () => {
    const { knex, whereRawSpy } = buildLanguageKnex({ language: 'de' });
    const repo = new UsersRepository(knex as any);

    const language = await repo.getLanguageByEmail('  User@Example.COM  ');

    expect(whereRawSpy).toHaveBeenCalledWith('LOWER(TRIM(email)) = LOWER(?)', [
      'User@Example.COM',
    ]);
    expect(language).toBe('de');
  });

  it('returns null when no user row matches', async () => {
    const { knex } = buildLanguageKnex(undefined);
    const repo = new UsersRepository(knex as any);

    const language = await repo.getLanguageByEmail('missing@example.com');

    expect(language).toBeNull();
  });

  it('returns null when the matched user has no language set', async () => {
    const { knex } = buildLanguageKnex({ language: null });
    const repo = new UsersRepository(knex as any);

    const language = await repo.getLanguageByEmail('user@example.com');

    expect(language).toBeNull();
  });
});

describe('UsersRepository.updatePatreonByEmail', () => {
  it('matches the user by email using TRIM + lowercase so Stripe casing differences still update', async () => {
    const knex = buildKnexMock();
    const repo = new UsersRepository(knex as any);

    await repo.updatePatreonByEmail('  John@Example.COM ', true);

    expect(knex.whereRawSpy).toHaveBeenCalledWith('TRIM(LOWER(email)) = ?', [
      'john@example.com',
    ]);
    expect(knex.updateSpy).toHaveBeenCalledWith({ patreon: true });
  });

  it('returns the number of rows affected', async () => {
    const knex = buildKnexMock();
    knex.updateSpy.mockResolvedValue(1);
    const repo = new UsersRepository(knex as any);

    const rowsAffected = await repo.updatePatreonByEmail(
      'user@example.com',
      true
    );

    expect(rowsAffected).toBe(1);
  });
});

describe('UsersRepository.createUserAndSeedFromTombstone', () => {
  function buildTrxKnex(tombstoneSeed: any) {
    const insertReturning = jest.fn().mockResolvedValue([{ id: 99 }]);
    const updateSpy = jest.fn().mockResolvedValue(1);
    const whereForUpdate = { update: updateSpy };
    const trx: any = jest.fn().mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          insert: jest.fn().mockReturnValue({ returning: insertReturning }),
          where: jest.fn().mockReturnValue(whereForUpdate),
        };
      }
      return {};
    });
    const transaction = jest.fn().mockImplementation(async (cb) => cb(trx));
    const knex: any = jest.fn();
    knex.transaction = transaction;
    const tombstoneRepo = {
      snapshot: jest.fn().mockResolvedValue(undefined),
      consumeIfCurrentMonth: jest.fn().mockResolvedValue(tombstoneSeed),
    };
    return { knex, tombstoneRepo, updateSpy, insertReturning };
  }

  it('inserts the user and skips the seed update when no tombstone exists', async () => {
    const { knex, tombstoneRepo, updateSpy } = buildTrxKnex(null);
    const repo = new UsersRepository(knex as any, tombstoneRepo as any);

    const result = await repo.createUserAndSeedFromTombstone(
      'al',
      SAMPLE_HASH,
      'al@example.com',
      '/notion-to-anki'
    );

    expect(result).toEqual([{ id: 99 }]);
    expect(tombstoneRepo.consumeIfCurrentMonth).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('seeds counters on the new user when a current-month tombstone is found', async () => {
    const seed = {
      cards_used_this_month: 80,
      cards_month_started_at: new Date('2026-05-01T00:00:00Z'),
      pdf_prints_this_month: 1,
      prints_month_started_at: new Date('2026-05-01T00:00:00Z'),
    };
    const { knex, tombstoneRepo, updateSpy } = buildTrxKnex(seed);
    const repo = new UsersRepository(knex as any, tombstoneRepo as any);

    await repo.createUserAndSeedFromTombstone(
      'al',
      SAMPLE_HASH,
      'al@example.com',
      null,
      new Date('2026-05-24T00:00:00Z')
    );

    expect(updateSpy).toHaveBeenCalledWith({
      cards_used_this_month: 80,
      cards_month_started_at: seed.cards_month_started_at,
      pdf_prints_this_month: 1,
      prints_month_started_at: seed.prints_month_started_at,
    });
  });

  it('falls back to now for null month-start values so the NOT NULL columns never receive null', async () => {
    const now = new Date('2026-05-24T00:00:00Z');
    const seed = {
      cards_used_this_month: 0,
      cards_month_started_at: null,
      pdf_prints_this_month: 0,
      prints_month_started_at: null,
    };
    const { knex, tombstoneRepo, updateSpy } = buildTrxKnex(seed);
    const repo = new UsersRepository(knex as any, tombstoneRepo as any);

    await repo.createUserAndSeedFromTombstone(
      'al',
      SAMPLE_HASH,
      'al@example.com',
      null,
      now
    );

    expect(updateSpy).toHaveBeenCalledWith({
      cards_used_this_month: 0,
      cards_month_started_at: now,
      pdf_prints_this_month: 0,
      prints_month_started_at: now,
    });
  });
});

describe('UsersRepository.deleteUser', () => {
  it('snapshots usage to the tombstone before deleting the user', async () => {
    const userRow = {
      email: 'al@example.com',
      cards_used_this_month: 80,
      cards_month_started_at: new Date('2026-05-01T00:00:00Z'),
      pdf_prints_this_month: 1,
      prints_month_started_at: new Date('2026-05-01T00:00:00Z'),
    };
    const deleteOrder: string[] = [];
    const trx: any = jest.fn().mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          where: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              first: jest.fn().mockResolvedValue(userRow),
            }),
            del: jest.fn().mockImplementation(() => {
              deleteOrder.push('users');
              return Promise.resolve(1);
            }),
          }),
        };
      }
      return {
        where: jest.fn().mockReturnValue({
          del: jest.fn().mockImplementation(() => {
            deleteOrder.push(table);
            return Promise.resolve(1);
          }),
        }),
      };
    });
    const transaction = jest.fn().mockImplementation(async (cb) => cb(trx));
    const knex: any = jest.fn();
    knex.transaction = transaction;
    const tombstoneRepo = {
      snapshot: jest.fn().mockResolvedValue(undefined),
      consumeIfCurrentMonth: jest.fn(),
    };

    const repo = new UsersRepository(knex as any, tombstoneRepo as any);
    await repo.deleteUser('42');

    expect(tombstoneRepo.snapshot).toHaveBeenCalledTimes(1);
    const [, counters] = tombstoneRepo.snapshot.mock.calls[0];
    expect(counters).toEqual({
      cards_used_this_month: 80,
      cards_month_started_at: userRow.cards_month_started_at,
      pdf_prints_this_month: 1,
      prints_month_started_at: userRow.prints_month_started_at,
    });
    expect(deleteOrder[deleteOrder.length - 1]).toBe('users');
  });

  it('skips the snapshot when the user row has no email', async () => {
    const trx: any = jest.fn().mockImplementation(() => ({
      where: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          first: jest.fn().mockResolvedValue({ email: null }),
        }),
        del: jest.fn().mockResolvedValue(1),
      }),
    }));
    const transaction = jest.fn().mockImplementation(async (cb) => cb(trx));
    const knex: any = jest.fn();
    knex.transaction = transaction;
    const tombstoneRepo = {
      snapshot: jest.fn(),
      consumeIfCurrentMonth: jest.fn(),
    };

    const repo = new UsersRepository(knex as any, tombstoneRepo as any);
    await repo.deleteUser('42');

    expect(tombstoneRepo.snapshot).not.toHaveBeenCalled();
  });
});

describe('UsersRepository.countTotalUsers', () => {
  it('counts every row in the users table and coerces the string count to a number', async () => {
    const firstSpy = jest.fn().mockResolvedValue({ count: '19389' });
    const countSpy = jest.fn().mockReturnValue({ first: firstSpy });
    const knex = jest
      .fn()
      .mockReturnValue({ count: countSpy }) as unknown as jest.Mock;
    const repo = new UsersRepository(knex as any);

    const total = await repo.countTotalUsers();

    expect(countSpy).toHaveBeenCalledWith('* as count');
    expect(total).toBe(19389);
  });

  it('returns 0 when the count row is missing', async () => {
    const firstSpy = jest.fn().mockResolvedValue(undefined);
    const countSpy = jest.fn().mockReturnValue({ first: firstSpy });
    const knex = jest
      .fn()
      .mockReturnValue({ count: countSpy }) as unknown as jest.Mock;
    const repo = new UsersRepository(knex as any);

    const total = await repo.countTotalUsers();

    expect(total).toBe(0);
  });
});

describe('UsersRepository.countSignupsSince', () => {
  it('binds the cutoff date against created_at and coerces the count', async () => {
    const firstSpy = jest.fn().mockResolvedValue({ count: '42' });
    const countSpy = jest.fn().mockReturnValue({ first: firstSpy });
    const whereSpy = jest.fn().mockReturnValue({ count: countSpy });
    const knex = jest
      .fn()
      .mockReturnValue({ where: whereSpy }) as unknown as jest.Mock;
    const repo = new UsersRepository(knex as any);

    const since = new Date('2026-05-30T14:32:07.000Z');
    const count = await repo.countSignupsSince(since);

    expect(whereSpy).toHaveBeenCalledWith('created_at', '>=', since);
    expect(countSpy).toHaveBeenCalledWith('* as count');
    expect(count).toBe(42);
  });
});

describe('UsersRepository.incrementPrintUsage', () => {
  const pg = Knex({ client: 'pg' });

  afterAll(() => pg.destroy());

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stamps the month boundary in UTC so getPrintUsage counts the print in the same month', () => {
    jest.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    const repo = new UsersRepository(pg as any);

    const { bindings } = repo.incrementPrintUsage(1).toSQL();
    const stampedBoundary = bindings.find(
      (binding): binding is Date => binding instanceof Date
    );

    expect(stampedBoundary).toBeInstanceOf(Date);
    expect((stampedBoundary as Date).toISOString()).toBe(
      startOfMonthUtc(new Date()).toISOString()
    );
    expect(isNewMonth(stampedBoundary as Date, new Date())).toBe(false);
  });
});

const RUN_INTEGRATION = process.env.DATABASE_URL != null;

(RUN_INTEGRATION ? describe : describe.skip)(
  'UsersRepository.deleteUser — FK cascade (integration)',
  () => {
    const db = Knex(KnexConfig);
    let userId: number;

    beforeEach(async () => {
      const rows = await db('users')
        .insert({
          name: 'cascade-test',
          email: `cascade-test-${Date.now()}@example.com`,
          password: SAMPLE_HASH,
        })
        .returning('id');
      userId = rows[0].id;

      await db('inactivity_emails').insert({
        user_id: userId,
        token: `inactivity-tok-${userId}`,
      });

      await db('re_engagement_emails').insert({
        user_id: userId,
        token: `reengagement-tok-${userId}`,
      });

      await db('email_preferences').insert({
        user_id: userId,
        marketing_opt_out: false,
      });

      await db('favorites').insert({
        owner: userId,
        object_id: `fav-obj-${userId}`,
        type: 'page',
      });
    });

    afterEach(async () => {
      await db('inactivity_emails').where({ user_id: userId }).del();
      await db('re_engagement_emails').where({ user_id: userId }).del();
      await db('email_preferences').where({ user_id: userId }).del();
      await db('favorites').where({ owner: userId }).del();
      await db('users').where({ id: userId }).del();
    });

    afterAll(() => db.destroy());

    it('removes the user and cascades to inactivity_emails and re_engagement_emails', async () => {
      const repo = new UsersRepository(db);

      await repo.deleteUser(String(userId));

      const user = await db('users').where({ id: userId }).first();
      const inactivity = await db('inactivity_emails')
        .where({ user_id: userId })
        .first();
      const reEngagement = await db('re_engagement_emails')
        .where({ user_id: userId })
        .first();

      expect(user).toBeUndefined();
      expect(inactivity).toBeUndefined();
      expect(reEngagement).toBeUndefined();
    });

    it('deletes a user that has an email_preferences row without an FK violation', async () => {
      const repo = new UsersRepository(db);

      await repo.deleteUser(String(userId));

      const user = await db('users').where({ id: userId }).first();
      const preferences = await db('email_preferences')
        .where({ user_id: userId })
        .first();

      expect(user).toBeUndefined();
      expect(preferences).toBeUndefined();
    });

    it('cascades to favorites when the user is deleted', async () => {
      const repo = new UsersRepository(db);

      await repo.deleteUser(String(userId));

      const favorite = await db('favorites').where({ owner: userId }).first();

      expect(favorite).toBeUndefined();
    });

    // A claim token is written before the claim is confirmed, so merely being
    // issued a claim link made the account permanently undeletable.
    it('deletes a user who has claimed an anonymous pass, releasing the pass', async () => {
      const repo = new UsersRepository(db);
      const passRows = await db('anonymous_passes')
        .insert({
          stripe_session_id: `cs_claim_${userId}`,
          kind: '7d',
          expires_at: new Date(Date.now() + 86_400_000),
          payment_intent_id: `pi_claim_${userId}`,
          claimed_by_user_id: userId,
        })
        .returning('id');
      const passId = passRows[0].id;
      await db('pass_claim_tokens').insert({
        user_id: userId,
        anonymous_pass_id: passId,
        token_hash: `claim-tok-${userId}`,
        expires_at: new Date(Date.now() + 3_600_000),
      });

      try {
        await repo.deleteUser(String(userId));

        expect(await db('users').where({ id: userId }).first()).toBeUndefined();
        expect(
          await db('pass_claim_tokens').where({ user_id: userId }).first()
        ).toBeUndefined();

        // The pass outlives the user — it was paid for and may be re-claimed.
        const pass = await db('anonymous_passes').where({ id: passId }).first();
        expect(pass).toBeDefined();
        expect(pass.claimed_by_user_id).toBeNull();
      } finally {
        await db('pass_claim_tokens').where({ user_id: userId }).del();
        await db('anonymous_passes').where({ id: passId }).del();
      }
    });
  }
);
