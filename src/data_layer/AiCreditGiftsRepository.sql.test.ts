import knex from 'knex';
import { AiCreditGiftsRepository } from './AiCreditGiftsRepository';

const db = knex({ client: 'pg' });
const repo = new AiCreditGiftsRepository(db);
const NOW = new Date('2026-11-25T12:00:00.000Z');

afterAll(async () => {
  await db.destroy();
});

describe('AiCreditGiftsRepository generated SQL', () => {
  it('charges a gift for every call stamped with its id, refusals included', () => {
    const { sql, bindings } = repo
      .buildGiftCostQuery(4, 12, NOW)
      .toSQL()
      .toNative();

    expect(sql).toBe(
      `select coalesce(sum((props->>'cost_usd')::numeric), 0) as cost_usd from "events" where "name" = $1 and "user_id" = $2 and "created_at" >= $3 and props->>'gift_id' = $4`
    );
    expect(bindings).toEqual(['ai_usage_recorded', 12, NOW, '4']);
  });

  it('counts unexpired gifts at their full amount or their cost, expired ones at their cost', () => {
    const { sql, bindings } = repo.buildExposureQuery(NOW).toSQL().toNative();

    expect(sql.replaceAll(/\s+/g, ' ')).toBe(
      "select coalesce(sum(case when g.expires_at > $1 then greatest(g.credits::numeric, coalesce(s.cost_usd, 0) / 0.01) else coalesce(s.cost_usd, 0) / 0.01 end), 0) as exposure from ai_credit_gifts g left join ( select props->>'gift_id' as gift_id, sum((props->>'cost_usd')::numeric) as cost_usd from events where name = $2 and props->>'gift_id' is not null and created_at >= (select coalesce(min(claimed_at), $3) from ai_credit_gifts) group by props->>'gift_id' ) s on s.gift_id = g.id::text"
    );
    expect(bindings).toEqual([NOW, 'ai_usage_recorded', NOW]);
  });

  it('records the one answer only while none is stored', () => {
    const { sql, bindings } = repo
      .buildRecordFeedbackQuery(12, NOW)
      .toSQL()
      .toNative();

    expect(sql).toBe(
      'update "ai_credit_gifts" set "feedback_answered_at" = $1 where "user_id" = $2 and "feedback_answered_at" is null returning "id"'
    );
    expect(bindings).toEqual([NOW, 12]);
  });

  it('counts claims from one hashed network over the last 24 hours', () => {
    const { sql, bindings } = repo
      .buildIpClaimCountQuery('abc', NOW)
      .toSQL()
      .toNative();

    expect(sql).toBe(
      'select count(*) as "count" from "ai_credit_gifts" where "ip_hash" = $1 and "claimed_at" > $2'
    );
    expect(bindings).toEqual(['abc', new Date('2026-11-24T12:00:00.000Z')]);
  });
});
