import knex from 'knex';

import { AnonymousPassRepository } from './AnonymousPassRepository';
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
});
