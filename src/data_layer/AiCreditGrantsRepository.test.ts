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
});
