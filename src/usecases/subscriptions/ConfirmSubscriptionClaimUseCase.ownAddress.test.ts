import { vi } from 'vitest';
import knex, { Knex } from 'knex';
import type StripeTypes from 'stripe';

import { ConfirmSubscriptionClaimUseCase } from './ConfirmSubscriptionClaimUseCase';
import type { ISubscriptionClaimTokensRepository } from '../../data_layer/SubscriptionClaimTokensRepository';
import type { ISubscriptionClaimAuditRepository } from '../../data_layer/SubscriptionClaimAuditRepository';
import type UsersRepository from '../../data_layer/UsersRepository';
import type { SubscriptionService } from '../../services/SubscriptionService';

const ACCOUNT = 'payer@example.com';

describe('ConfirmSubscriptionClaimUseCase for a claim on the account address', () => {
  let database: Knex;

  beforeEach(async () => {
    vi.stubEnv('THE_HASHING_SECRET', 'own-address-test-hash-secret');
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await database.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
      t.text('stripe_customer_id').nullable();
      t.boolean('email_verified').notNullable().defaultTo(false);
    });
    await database('users').insert({ id: 7, email: ACCOUNT });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await database.destroy();
  });

  const confirm = (customerEmail: string | null) =>
    new ConfirmSubscriptionClaimUseCase(
      database,
      {
        findByTokenHash: vi.fn().mockResolvedValue({
          id: 1,
          user_id: 7,
          stripe_customer_id: 'cus_1',
          expires_at: new Date(Date.now() + 60_000),
          consumed_at: null,
        }),
        markConsumed: vi.fn().mockResolvedValue(undefined),
      } as unknown as ISubscriptionClaimTokensRepository,
      {
        insert: vi.fn().mockResolvedValue(undefined),
      } as unknown as ISubscriptionClaimAuditRepository,
      {
        getEmailById: vi.fn().mockResolvedValue(ACCOUNT),
      } as unknown as UsersRepository,
      {
        findActiveStripeSubscriptions: vi.fn().mockResolvedValue([]),
      } as unknown as typeof SubscriptionService,
      {
        customers: {
          retrieve: vi.fn().mockResolvedValue({
            id: 'cus_1',
            email: customerEmail,
            subscriptions: { data: [] },
          }),
        },
      } as unknown as StripeTypes
    ).execute(7, 'raw-token', 'ip-hash', 'email-hash');

  const claimed = async () =>
    (await database('users').where({ id: 7 }).first()).stripe_customer_id;

  it('answers that a plan is already there, and proves nothing, on the account address', async () => {
    const outcome = await confirm('PAYER@example.com');

    expect(outcome).toEqual({ success: false, reason: 'user_has_active_sub' });
    await expect(claimed()).resolves.toBeNull();
    expect(
      Boolean((await database('users').where({ id: 7 }).first()).email_verified)
    ).toBe(false);
  });

  it('claims a plan paid from another mailbox', async () => {
    const outcome = await confirm('other@example.com');

    expect(outcome).toEqual({ success: true });
    await expect(claimed()).resolves.toBe('cus_1');
  });

  it('claims for a customer with no email', async () => {
    const outcome = await confirm(null);

    expect(outcome).toEqual({ success: true });
  });
});
