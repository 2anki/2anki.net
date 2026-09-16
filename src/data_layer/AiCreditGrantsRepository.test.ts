import knex from 'knex';
import { AiCreditGrantsRepository } from './AiCreditGrantsRepository';

const pg = knex({ client: 'pg' });

describe('AiCreditGrantsRepository generated SQL', () => {
  it('sums only unexpired grants for the user', () => {
    const repo = new AiCreditGrantsRepository(pg);
    const now = new Date('2026-05-12T00:00:00.000Z');
    const sql = repo.buildSumActiveCreditsQuery(42, now).toString();
    expect(sql).toContain('from "ai_credit_grants"');
    expect(sql).toContain('"user_id" = 42');
    expect(sql).toContain('"expires_at" >');
    expect(sql).toContain('sum("amount_credits")');
    expect(sql).toContain('"credits"');
  });

  it('inserts a pack grant that ignores a duplicate stripe session id', () => {
    const repo = new AiCreditGrantsRepository(pg);
    const sql = repo
      .buildInsertPackGrantQuery({
        userId: 42,
        amountCredits: 250,
        expiresAt: new Date('2026-08-10T00:00:00.000Z'),
        stripeSessionId: 'cs_test_123',
      })
      .toString();
    expect(sql).toContain('insert into "ai_credit_grants"');
    expect(sql).toContain('on conflict ("stripe_session_id") do nothing');
    expect(sql).toContain("'pack'");
    expect(sql).toContain('cs_test_123');
    expect(sql).toContain('returning "id"');
  });
});
