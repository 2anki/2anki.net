import knex from 'knex';

import { AnonymousPassRepository } from './AnonymousPassRepository';
import {
  RefundedPaymentIntentsRepository,
  refundAwareExpiry,
} from './RefundedPaymentIntentsRepository';
import { UserPassRepository } from './UserPassRepository';

const now = new Date('2026-10-15T12:00:00.000Z');

describe('ending a refunded pass — generated SQL', () => {
  const pg = knex({ client: 'pg' });

  afterAll(async () => {
    await pg.destroy();
  });

  it('moves a running user pass expiry back to now, keyed by payment intent', () => {
    const { sql, bindings } = new UserPassRepository(pg)
      .buildEndByPaymentIntentIdQuery('pi_refund', now)
      .toSQL();

    expect(sql).toBe(
      'update "user_passes" set "expires_at" = ? where "stripe_payment_intent_id" = ? and "expires_at" > ? returning *'
    );
    expect(bindings).toEqual([now, 'pi_refund', now]);
  });

  it('moves a running anonymous pass expiry back to now, keyed by payment intent', () => {
    const { sql, bindings } = new AnonymousPassRepository(pg)
      .buildEndByPaymentIntentIdQuery('pi_refund', now)
      .toSQL();

    expect(sql).toBe(
      'update "anonymous_passes" set "expires_at" = ? where "payment_intent_id" = ? and "expires_at" > ? returning *'
    );
    expect(bindings).toEqual([now, 'pi_refund', now]);
  });

  const notRefunded =
    'not exists (select 1 from "refunded_payment_intents" where "refunded_payment_intents"."payment_intent_id" = "anonymous_passes"."payment_intent_id")';

  it('refuses to claim an anonymous pass whose payment was refunded, in the same UPDATE', () => {
    const { sql, bindings } = new AnonymousPassRepository(pg)
      .buildClaimQuery(5, 42)
      .toSQL();

    expect(sql).toBe(
      `update "anonymous_passes" set "claimed_by_user_id" = ? where "id" = ? and "claimed_by_user_id" is null and ${notRefunded}`
    );
    expect(bindings).toEqual([42, 5]);
  });

  it('refuses to activate an ended or refunded anonymous pass, in the same UPDATE', () => {
    const later = new Date(now.getTime() + 86_400_000);
    const { sql, bindings } = new AnonymousPassRepository(pg)
      .buildActivateQuery(5, now, later)
      .toSQL();

    expect(sql).toBe(
      `update "anonymous_passes" set "activated_at" = ?, "expires_at" = ? where "id" = ? and "activated_at" is null and "expires_at" > ? and ${notRefunded}`
    );
    expect(bindings).toEqual([now, later, 5, now]);
  });

  it('records a refunded payment intent idempotently', () => {
    const { sql, bindings } = new RefundedPaymentIntentsRepository(pg)
      .buildMarkRefundedQuery('pi_refund', now)
      .toSQL();

    expect(sql).toBe(
      'insert into "refunded_payment_intents" ("payment_intent_id", "refunded_at") values (?, ?) on conflict ("payment_intent_id") do nothing'
    );
    expect(bindings).toEqual(['pi_refund', now]);
  });

  it('writes a refund-aware expiry when granting a pass', () => {
    const later = new Date(now.getTime() + 86_400_000);
    const { sql, bindings } = refundAwareExpiry(pg, 'pi_refund', later).toSQL();

    expect(sql).toBe(
      'case when exists (select 1 from "refunded_payment_intents" where "payment_intent_id" = ?) then least(?::timestamptz, now()) else ?::timestamptz end'
    );
    expect(bindings).toEqual(['pi_refund', later, later]);
  });
});
