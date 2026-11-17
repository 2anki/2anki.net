import Knex from 'knex';
import KnexConfig from '../KnexConfig';
import { ADVISORY_LOCK_NAMESPACES } from './JobLockRepository';
import { UserPassRepository } from './UserPassRepository';

const DAY_MS = 24 * 60 * 60 * 1000;
const DURATION_7D = 7 * DAY_MS;
const DURATION_120D = 120 * DAY_MS;
const NOW = new Date('2030-01-01T12:00:00.000Z');
const MISSING_USER_ID = 2_147_483_000;
const SAMPLE_HASH = 'hashed-pw';

const RUN_INTEGRATION = process.env.DATABASE_URL != null;

(RUN_INTEGRATION ? describe : describe.skip)(
  'UserPassRepository.upsertWithExtension under concurrency (integration)',
  () => {
    const db = Knex(KnexConfig);
    const createdUserIds: number[] = [];
    let sequence = 0;

    const nextIntent = () =>
      `pi_lock_test_${process.pid}_${Date.now()}_${sequence++}`;

    async function createUser(): Promise<number> {
      const [row] = await db('users')
        .insert({
          name: 'pass-lock-test',
          email: `pass-lock-test-${process.pid}-${Date.now()}-${sequence++}@example.com`,
          password: SAMPLE_HASH,
        })
        .returning('id');
      createdUserIds.push(row.id);
      return row.id;
    }

    async function passesFor(userId: number) {
      return db('user_passes')
        .where('user_id', userId)
        .orderBy('expires_at', 'asc');
    }

    async function latestExpiry(userId: number): Promise<number> {
      const rows = await passesFor(userId);
      return new Date(rows[rows.length - 1].expires_at).getTime();
    }

    afterEach(async () => {
      await db('user_passes').whereIn('user_id', createdUserIds).del();
      await db('users').whereIn('id', createdUserIds).del();
      createdUserIds.length = 0;
    });

    afterAll(() => db.destroy());

    it('two concurrent grants for one user both count: expiry is base plus both durations', async () => {
      const userId = await createUser();
      const repo = new UserPassRepository(db);

      await Promise.all([
        repo.upsertWithExtension(userId, '7d', DURATION_7D, nextIntent(), NOW),
        repo.upsertWithExtension(userId, '7d', DURATION_7D, nextIntent(), NOW),
      ]);

      expect(await passesFor(userId)).toHaveLength(2);
      expect(await latestExpiry(userId)).toBe(NOW.getTime() + 2 * DURATION_7D);
    });

    it('a concurrent renewal and a Day Pass credit upgrade both stack onto a running Semester Pass', async () => {
      const userId = await createUser();
      const repo = new UserPassRepository(db);
      const semesterEnd = NOW.getTime() + 3 * DAY_MS;
      await db('user_passes').insert({
        user_id: userId,
        kind: '120d',
        expires_at: new Date(semesterEnd),
        stripe_payment_intent_id: nextIntent(),
      });

      await Promise.all([
        repo.upsertWithExtension(
          userId,
          '120d',
          DURATION_120D,
          nextIntent(),
          NOW
        ),
        repo.upsertWithExtension(
          userId,
          '120d',
          DURATION_120D,
          nextIntent(),
          NOW
        ),
      ]);

      expect(await passesFor(userId)).toHaveLength(3);
      expect(await latestExpiry(userId)).toBe(semesterEnd + 2 * DURATION_120D);
    });

    it('a signed-in purchase extends from a claimed signed-out pass', async () => {
      const userId = await createUser();
      const repo = new UserPassRepository(db);
      const claimedEnd = new Date(NOW.getTime() + DAY_MS);
      await repo.upsertWithAbsoluteExpiry(
        userId,
        '24h',
        claimedEnd,
        nextIntent()
      );

      await repo.upsertWithExtension(
        userId,
        '7d',
        DURATION_7D,
        nextIntent(),
        NOW
      );

      expect(await latestExpiry(userId)).toBe(
        claimedEnd.getTime() + DURATION_7D
      );
    });

    it('a replayed payment intent delivered twice at once grants one pass', async () => {
      const userId = await createUser();
      const repo = new UserPassRepository(db);
      const intent = nextIntent();

      const [first, second] = await Promise.all([
        repo.upsertWithExtension(userId, '7d', DURATION_7D, intent, NOW),
        repo.upsertWithExtension(userId, '7d', DURATION_7D, intent, NOW),
      ]);

      expect(second.id).toBe(first.id);
      expect(await passesFor(userId)).toHaveLength(1);
      expect(await latestExpiry(userId)).toBe(NOW.getTime() + DURATION_7D);
    });

    it('a grant waits while its user is locked, and another user is not held up', async () => {
      const lockedUser = await createUser();
      const otherUser = await createUser();
      const repo = new UserPassRepository(db);
      let releaseHolder: () => void = () => undefined;
      let markHolderLocked: () => void = () => undefined;
      const holderLocked = new Promise<void>((resolve) => {
        markHolderLocked = resolve;
      });

      const holder = db.transaction(async (trx) => {
        await trx.raw('select pg_advisory_xact_lock(?, ?)', [
          ADVISORY_LOCK_NAMESPACES.userPassGrants,
          lockedUser,
        ]);
        markHolderLocked();
        await new Promise<void>((resolve) => {
          releaseHolder = resolve;
        });
      });
      await holderLocked;

      let lockedGrantSettled = false;
      const lockedGrant = repo
        .upsertWithExtension(lockedUser, '7d', DURATION_7D, nextIntent(), NOW)
        .finally(() => {
          lockedGrantSettled = true;
        });

      const otherGrant = await repo.upsertWithExtension(
        otherUser,
        '7d',
        DURATION_7D,
        nextIntent(),
        NOW
      );

      expect(otherGrant.expires_at.getTime()).toBe(NOW.getTime() + DURATION_7D);
      expect(lockedGrantSettled).toBe(false);
      expect(await passesFor(lockedUser)).toHaveLength(0);

      releaseHolder();
      await holder;
      await lockedGrant;

      expect(await passesFor(lockedUser)).toHaveLength(1);
    });

    it('a failed insert rolls back and leaves the user lock free', async () => {
      const repo = new UserPassRepository(db);
      const intent = nextIntent();

      await expect(
        repo.upsertWithExtension(
          MISSING_USER_ID,
          '7d',
          DURATION_7D,
          intent,
          NOW
        )
      ).rejects.toMatchObject({ code: '23503' });

      const lockFree = await db.transaction(async (trx) => {
        const result = await trx.raw(
          'select pg_try_advisory_xact_lock(?, ?) as locked',
          [ADVISORY_LOCK_NAMESPACES.userPassGrants, MISSING_USER_ID]
        );
        return result.rows[0].locked;
      });
      expect(lockFree).toBe(true);
      expect(
        await db('user_passes').where('stripe_payment_intent_id', intent)
      ).toEqual([]);
    });
  }
);
