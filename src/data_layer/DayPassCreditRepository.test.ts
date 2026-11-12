import knex from 'knex';
import {
  DayPassCreditRepository,
  InMemoryDayPassCreditRepository,
} from './DayPassCreditRepository';

const pg = knex({ client: 'pg' });

describe('DayPassCreditRepository generated SQL', () => {
  const repo = new DayPassCreditRepository(pg);

  it('reads the latest Stripe Day Pass still within reach, skipping refunded and signed-out purchases', () => {
    const expiresAfter = new Date('2026-11-11T12:00:00.000Z');
    const expiresBy = new Date('2026-11-13T12:00:00.000Z');
    const query = repo.buildFindRecentDayPassQuery(42, {
      expiresAfter,
      expiresBy,
    });
    const sql = query.toString();
    expect(sql).toContain('from "user_passes"');
    expect(sql).toContain('"user_passes"."user_id" = 42');
    expect(sql).toContain('"user_passes"."kind" = \'24h\'');
    const compiled = query.toSQL();
    expect(compiled.sql).toContain(
      '"user_passes"."stripe_payment_intent_id" like ?'
    );
    expect(compiled.sql).toContain('"user_passes"."expires_at" > ?');
    expect(compiled.sql).toContain('"user_passes"."expires_at" <= ?');
    expect(compiled.bindings).toEqual(
      expect.arrayContaining(['pi\\_%', expiresAfter, expiresBy])
    );
    expect(sql).toContain(
      'not exists (select 1 from "refunded_payment_intents" where "refunded_payment_intents"."payment_intent_id" = "user_passes"."stripe_payment_intent_id")'
    );
    expect(sql).toContain(
      'not exists (select 1 from "anonymous_passes" where "anonymous_passes"."payment_intent_id" = "user_passes"."stripe_payment_intent_id")'
    );
    expect(sql).toContain('order by "user_passes"."expires_at" desc');
    expect(sql).toContain('limit 1');
  });

  it('claims a credit once per Day Pass payment intent', () => {
    const sql = repo.buildClaimQuery(42, 'pi_day').toString();
    expect(sql).toContain('insert into "day_pass_credits"');
    expect(sql).toContain(
      'on conflict ("day_pass_payment_intent_id") do nothing'
    );
  });

  it('attaches a session only while the previous one is still the recorded one', () => {
    const fromNone = repo.buildAttachSessionQuery(7, null, 'cs_new').toString();
    expect(fromNone).toContain('update "day_pass_credits"');
    expect(fromNone).toContain('"checkout_session_id" = \'cs_new\'');
    expect(fromNone).toContain('"id" = 7');
    expect(fromNone).toContain('"checkout_session_id" is null');
    expect(fromNone).toContain('"redeemed_at" is null');

    const fromPrevious = repo
      .buildAttachSessionQuery(7, 'cs_old', 'cs_new')
      .toString();
    expect(fromPrevious).toContain('"checkout_session_id" = \'cs_old\'');
  });

  it('marks a credit redeemed by its paid session, once', () => {
    const sql = repo
      .buildMarkRedeemedQuery('cs_paid', new Date('2026-11-12T00:00:00.000Z'))
      .toString();
    expect(sql).toContain('update "day_pass_credits"');
    expect(sql).toContain('"redeemed_at" =');
    expect(sql).toContain('"checkout_session_id" = \'cs_paid\'');
    expect(sql).toContain('"redeemed_at" is null');
  });
});

describe('InMemoryDayPassCreditRepository', () => {
  it('returns the same credit row when claimed twice', async () => {
    const repo = new InMemoryDayPassCreditRepository();
    const first = await repo.claim(42, 'pi_day');
    const second = await repo.claim(42, 'pi_day');
    expect(second).toEqual(first);
  });

  it('refuses to attach a session over one it did not expect', async () => {
    const repo = new InMemoryDayPassCreditRepository();
    const credit = await repo.claim(42, 'pi_day');
    expect(await repo.attachSession(credit.id, null, 'cs_a')).toBe(true);
    expect(await repo.attachSession(credit.id, null, 'cs_b')).toBe(false);
    expect(await repo.findByDayPass('pi_day')).toMatchObject({
      checkoutSessionId: 'cs_a',
    });
  });

  it('marks a credit redeemed only the first time its session is paid', async () => {
    const repo = new InMemoryDayPassCreditRepository();
    const credit = await repo.claim(42, 'pi_day');
    await repo.attachSession(credit.id, null, 'cs_a');
    const paidAt = new Date('2026-11-12T10:00:00.000Z');
    expect(await repo.markRedeemedBySession('cs_a', paidAt)).toBe(true);
    expect(await repo.markRedeemedBySession('cs_a', new Date())).toBe(false);
    expect(await repo.findByDayPass('pi_day')).toMatchObject({
      redeemedAt: paidAt,
    });
  });
});
