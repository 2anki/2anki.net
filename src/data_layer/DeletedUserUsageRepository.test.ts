import { vi } from 'vitest';
import Knex from 'knex';
import KnexConfig from '../KnexConfig';
import DeletedUserUsageRepository from './DeletedUserUsageRepository';
import { emailHash } from '../lib/emailHash';

const HASH = emailHash('tombstone-test@example.com');

describe('DeletedUserUsageRepository.consumeIfCurrentMonth — unit', () => {
  function buildKnex(rowFromDb: Record<string, unknown> | undefined) {
    const deleteSpy = vi.fn().mockResolvedValue(1);
    const firstSpy = vi.fn().mockResolvedValue(rowFromDb);
    const whereBuilder = { first: firstSpy, del: deleteSpy };
    const tableBuilder = { where: vi.fn().mockReturnValue(whereBuilder) };
    const knex = vi.fn().mockReturnValue(tableBuilder);
    return knex as unknown as ReturnType<typeof Knex>;
  }

  it('returns null when no row exists', async () => {
    const repo = new DeletedUserUsageRepository(buildKnex(undefined));
    const result = await repo.consumeIfCurrentMonth(
      HASH,
      new Date('2026-05-24T00:00:00Z')
    );
    expect(result).toBeNull();
  });

  it('returns null when the tombstone is from a prior month', async () => {
    const repo = new DeletedUserUsageRepository(
      buildKnex({
        cards_used_this_month: 80,
        cards_month_started_at: '2026-04-01T00:00:00Z',
        pdf_prints_this_month: 1,
        prints_month_started_at: '2026-04-01T00:00:00Z',
      })
    );
    const result = await repo.consumeIfCurrentMonth(
      HASH,
      new Date('2026-05-24T00:00:00Z')
    );
    expect(result).toBeNull();
  });

  it('returns seed when the tombstone is from the current month', async () => {
    const repo = new DeletedUserUsageRepository(
      buildKnex({
        cards_used_this_month: 80,
        cards_month_started_at: '2026-05-01T00:00:00Z',
        pdf_prints_this_month: 1,
        prints_month_started_at: '2026-05-01T00:00:00Z',
      })
    );
    const result = await repo.consumeIfCurrentMonth(
      HASH,
      new Date('2026-05-24T00:00:00Z')
    );
    expect(result).toEqual({
      cards_used_this_month: 80,
      cards_month_started_at: new Date('2026-05-01T00:00:00Z'),
      pdf_prints_this_month: 1,
      prints_month_started_at: new Date('2026-05-01T00:00:00Z'),
    });
  });

  it('seeds only the counter whose month matches (mixed-month tombstone)', async () => {
    const repo = new DeletedUserUsageRepository(
      buildKnex({
        cards_used_this_month: 80,
        cards_month_started_at: '2026-04-01T00:00:00Z',
        pdf_prints_this_month: 1,
        prints_month_started_at: '2026-05-01T00:00:00Z',
      })
    );
    const result = await repo.consumeIfCurrentMonth(
      HASH,
      new Date('2026-05-24T00:00:00Z')
    );
    expect(result).toEqual({
      cards_used_this_month: 0,
      cards_month_started_at: null,
      pdf_prints_this_month: 1,
      prints_month_started_at: new Date('2026-05-01T00:00:00Z'),
    });
  });

  it('deletes the tombstone row whether or not the seed survives the month filter', async () => {
    const deleteSpy = vi.fn().mockResolvedValue(1);
    const firstSpy = vi.fn().mockResolvedValue({
      cards_used_this_month: 80,
      cards_month_started_at: '2026-04-01T00:00:00Z',
      pdf_prints_this_month: 1,
      prints_month_started_at: '2026-04-01T00:00:00Z',
    });
    const whereBuilder = { first: firstSpy, del: deleteSpy };
    const tableBuilder = { where: vi.fn().mockReturnValue(whereBuilder) };
    const knex = vi.fn().mockReturnValue(tableBuilder) as unknown as ReturnType<
      typeof Knex
    >;

    const repo = new DeletedUserUsageRepository(knex);
    await repo.consumeIfCurrentMonth(HASH, new Date('2026-05-24T00:00:00Z'));

    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });
});

const RUN_INTEGRATION = process.env.DATABASE_URL != null;

(RUN_INTEGRATION ? describe : describe.skip)(
  'DeletedUserUsageRepository — integration',
  () => {
    const db = Knex(KnexConfig);
    const repo = new DeletedUserUsageRepository(db);
    const HASH_A = emailHash(`integration-a-${Date.now()}@example.com`);
    const HASH_B = emailHash(`integration-b-${Date.now()}@example.com`);

    afterEach(async () => {
      await db('deleted_user_usage')
        .whereIn('email_sha256', [HASH_A, HASH_B])
        .del();
    });

    afterAll(() => db.destroy());

    it('inserts on first snapshot', async () => {
      await repo.snapshot(HASH_A, {
        cards_used_this_month: 50,
        cards_month_started_at: new Date('2026-05-01T00:00:00Z'),
        pdf_prints_this_month: 1,
        prints_month_started_at: new Date('2026-05-01T00:00:00Z'),
      });
      const row = await db('deleted_user_usage')
        .where({ email_sha256: HASH_A })
        .first();
      expect(row.cards_used_this_month).toBe(50);
      expect(row.pdf_prints_this_month).toBe(1);
    });

    it('GREATEST wins on same-month re-snapshot', async () => {
      const month = new Date('2026-05-01T00:00:00Z');
      await repo.snapshot(HASH_A, {
        cards_used_this_month: 80,
        cards_month_started_at: month,
        pdf_prints_this_month: 0,
        prints_month_started_at: month,
      });
      await repo.snapshot(HASH_A, {
        cards_used_this_month: 30,
        cards_month_started_at: month,
        pdf_prints_this_month: 1,
        prints_month_started_at: month,
      });
      const row = await db('deleted_user_usage')
        .where({ email_sha256: HASH_A })
        .first();
      expect(row.cards_used_this_month).toBe(80);
      expect(row.pdf_prints_this_month).toBe(1);
    });

    it('takes the more-recent month on cross-month re-snapshot', async () => {
      await repo.snapshot(HASH_A, {
        cards_used_this_month: 80,
        cards_month_started_at: new Date('2026-04-01T00:00:00Z'),
        pdf_prints_this_month: 1,
        prints_month_started_at: new Date('2026-04-01T00:00:00Z'),
      });
      await repo.snapshot(HASH_A, {
        cards_used_this_month: 30,
        cards_month_started_at: new Date('2026-05-01T00:00:00Z'),
        pdf_prints_this_month: 0,
        prints_month_started_at: new Date('2026-05-01T00:00:00Z'),
      });
      const row = await db('deleted_user_usage')
        .where({ email_sha256: HASH_A })
        .first();
      expect(row.cards_used_this_month).toBe(30);
      expect(row.pdf_prints_this_month).toBe(0);
      expect(new Date(row.cards_month_started_at).toISOString()).toBe(
        '2026-05-01T00:00:00.000Z'
      );
    });

    it('keeps the older month value when re-snapshot is from a prior month', async () => {
      await repo.snapshot(HASH_A, {
        cards_used_this_month: 80,
        cards_month_started_at: new Date('2026-05-01T00:00:00Z'),
        pdf_prints_this_month: 1,
        prints_month_started_at: new Date('2026-05-01T00:00:00Z'),
      });
      await repo.snapshot(HASH_A, {
        cards_used_this_month: 30,
        cards_month_started_at: new Date('2026-04-01T00:00:00Z'),
        pdf_prints_this_month: 0,
        prints_month_started_at: new Date('2026-04-01T00:00:00Z'),
      });
      const row = await db('deleted_user_usage')
        .where({ email_sha256: HASH_A })
        .first();
      expect(row.cards_used_this_month).toBe(80);
      expect(row.pdf_prints_this_month).toBe(1);
    });
  }
);
