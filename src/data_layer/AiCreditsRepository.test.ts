import knex from 'knex';
import {
  AiCreditsRepository,
  parseSubscriptionPayload,
} from './AiCreditsRepository';

const pg = knex({ client: 'pg' });

describe('parseSubscriptionPayload', () => {
  it('reads item-level period and unit amount from a Stripe payload object', () => {
    const result = parseSubscriptionPayload({
      items: {
        data: [
          {
            current_period_start: 1_746_057_600,
            current_period_end: 1_748_736_000,
            price: { unit_amount: 799 },
          },
        ],
      },
    });
    expect(result).toEqual({
      periodStart: new Date(1_746_057_600 * 1000),
      periodEnd: new Date(1_748_736_000 * 1000),
      unitAmount: 799,
    });
  });

  it('falls back to a top-level billing period when the item has none', () => {
    const result = parseSubscriptionPayload({
      current_period_start: 1_746_057_600,
      current_period_end: 1_748_736_000,
      items: { data: [{ price: { unit_amount: 799 } }] },
    });
    expect(result).toEqual({
      periodStart: new Date(1_746_057_600 * 1000),
      periodEnd: new Date(1_748_736_000 * 1000),
      unitAmount: 799,
    });
  });

  it('parses a JSON string payload', () => {
    const result = parseSubscriptionPayload(
      JSON.stringify({ items: { data: [{ price: { unit_amount: 200 } }] } })
    );
    expect(result.unitAmount).toBe(200);
    expect(result.periodStart).toBeNull();
  });

  it('returns null period and amount for an unparseable payload', () => {
    const result = parseSubscriptionPayload('not json');
    expect(result).toEqual({
      periodStart: null,
      periodEnd: null,
      unitAmount: null,
    });
  });
});

describe('AiCreditsRepository generated SQL', () => {
  it('finds the active subscription by linked or payer email', () => {
    const repo = new AiCreditsRepository(pg);
    const sql = repo
      .buildActiveSubscriptionQuery('User@Example.com')
      .toString();
    expect(sql).toContain('from "subscriptions"');
    expect(sql).toContain('"linked_email" = \'user@example.com\'');
    expect(sql).toContain('"email" = \'user@example.com\'');
    expect(sql).toContain('"active" = true');
  });
});
