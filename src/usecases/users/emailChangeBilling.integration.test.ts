import knex, { Knex } from 'knex';
import type StripeTypes from 'stripe';

process.env.THE_HASHING_SECRET = 'test-secret-for-email-change-billing';

const stripeCustomers = vi.hoisted(() => ({
  emails: new Map<string, string | null>(),
  failUpdate: false,
  retrieve: vi.fn(),
  update: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class FakeStripe {
    customers = {
      retrieve: (id: string) => {
        stripeCustomers.retrieve(id);
        if (!stripeCustomers.emails.has(id)) {
          return Promise.resolve({ id, deleted: true });
        }
        return Promise.resolve({ id, email: stripeCustomers.emails.get(id) });
      },
      update: (id: string, params: { email: string }) => {
        stripeCustomers.update(id, params);
        if (stripeCustomers.failUpdate) {
          return Promise.reject(
            Object.assign(new Error('Stripe is down'), {
              type: 'StripeAPIError',
            })
          );
        }
        stripeCustomers.emails.set(id, params.email);
        return Promise.resolve({ id, email: params.email });
      },
    };
  },
}));

import UsersRepository from '../../data_layer/UsersRepository';
import EmailChangeTokenRepository from '../../data_layer/EmailChangeTokenRepository';
import { StripeCustomerEmailService } from '../../services/StripeCustomerEmailService';
import { updateStoreSubscription } from '../../lib/integrations/stripe';
import hmacToken from '../../lib/misc/hmacToken';
import { ConfirmEmailChangeUseCase } from './ConfirmEmailChangeUseCase';
import { ChangeUserEmailUseCase } from '../ops/ChangeUserEmailUseCase';

const LATER = new Date(Date.now() + 30 * 60 * 1000);
const RAW_TOKEN = 'raw-email-change-token';

interface SubscriptionRow {
  email: string;
  linked_email: string | null;
  active: boolean | number;
}

let database: Knex;

async function createSchema(db: Knex) {
  await db.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.text('email').notNullable();
    t.text('reset_token').nullable();
    t.timestamp('reset_token_expires_at').nullable();
    t.text('stripe_customer_id').nullable();
  });
  await db.schema.createTable('subscriptions', (t) => {
    t.increments('id').primary();
    t.text('email').unique().notNullable();
    t.boolean('active').notNullable().defaultTo(false);
    t.json('payload').notNullable();
    t.timestamp('created_at').nullable();
    t.timestamp('updated_at').nullable();
    t.text('linked_email').unique().nullable();
    t.text('stripe_product_id').nullable();
  });
  await db.schema.createTable('email_change_tokens', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.text('new_email').notNullable();
    t.text('token_hash').notNullable();
    t.timestamp('expires_at').notNullable();
    t.timestamp('consumed_at').nullable();
    t.timestamp('created_at').nullable();
  });
  await db.schema.createTable('magic_tokens', (t) => {
    t.increments('id').primary();
    t.integer('owner').notNullable();
    t.timestamp('used_at').nullable();
  });
  await db.schema.createTable('pause_resume_warning_notices', (t) => {
    t.increments('id').primary();
    t.text('subscription_email').notNullable();
    t.timestamp('resumes_at').notNullable();
  });
  await db.schema.createTable('developer_tiers', (t) => {
    t.increments('id').primary();
    t.text('stripe_product_id');
  });
}

function stripeSubscription(customer: string): StripeTypes.Subscription {
  return {
    id: `sub_${customer}`,
    customer,
    status: 'active',
    cancel_at_period_end: false,
    items: { data: [{ price: { product: 'prod_plan' } }] },
    metadata: {},
  } as unknown as StripeTypes.Subscription;
}

async function seedUser(email: string, stripeCustomerId: string | null = null) {
  const [{ id }] = await database('users')
    .insert({ email, stripe_customer_id: stripeCustomerId })
    .returning('id');
  return id as number;
}

async function seedSubscription(
  email: string,
  linkedEmail: string | null,
  customer: string
) {
  await database('subscriptions').insert({
    email,
    linked_email: linkedEmail,
    active: true,
    payload: JSON.stringify(stripeSubscription(customer)),
  });
}

async function subscriptions(): Promise<
  Array<{ email: string; linked_email: string | null; active: boolean }>
> {
  const rows: SubscriptionRow[] = await database('subscriptions')
    .select('email', 'linked_email', 'active')
    .orderBy('id');
  return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
}

async function signInEmail(userId: number): Promise<string> {
  const row = await database('users').where({ id: userId }).first();
  return row.email as string;
}

type Outcome = { changed: true } | { changed: false; reason: string };

async function confirmChange(userId: number, newEmail: string) {
  await database('email_change_tokens').insert({
    user_id: userId,
    new_email: newEmail,
    token_hash: hmacToken(RAW_TOKEN),
    expires_at: LATER,
  });
  const outcome = await new ConfirmEmailChangeUseCase(
    new EmailChangeTokenRepository(database),
    new UsersRepository(database),
    async () => undefined,
    new StripeCustomerEmailService()
  ).execute(RAW_TOKEN);
  return outcome.ok
    ? ({ changed: true } as Outcome)
    : ({ changed: false, reason: outcome.reason } as Outcome);
}

async function opsChange(userId: number, newEmail: string) {
  const outcome = await new ChangeUserEmailUseCase(
    new UsersRepository(database),
    new StripeCustomerEmailService()
  ).execute({ currentEmail: await signInEmail(userId), newEmail });
  return outcome.success
    ? ({ changed: true } as Outcome)
    : ({ changed: false, reason: outcome.reason } as Outcome);
}

beforeEach(async () => {
  database = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await createSchema(database);
  stripeCustomers.emails.clear();
  stripeCustomers.failUpdate = false;
  stripeCustomers.retrieve.mockClear();
  stripeCustomers.update.mockClear();
});

afterEach(async () => {
  await database.destroy();
});

describe.each([
  ['a user-confirmed email change', confirmChange, 'email_taken'],
  ['an ops email change', opsChange, 'new_email_taken'],
] as const)('%s with subscriptions', (_label, changeEmail, takenReason) => {
  it('moves the payer column and the Stripe customer email when the user pays', async () => {
    const userId = await seedUser('old@example.com', 'cus_payer');
    stripeCustomers.emails.set('cus_payer', 'old@example.com');
    await seedSubscription('old@example.com', 'friend@example.com', 'cus_payer');

    expect(await changeEmail(userId, 'new@example.com')).toEqual({
      changed: true,
    });

    expect(await subscriptions()).toEqual([
      {
        email: 'new@example.com',
        linked_email: 'friend@example.com',
        active: true,
      },
    ]);
    expect(stripeCustomers.emails.get('cus_payer')).toBe('new@example.com');
    expect(await signInEmail(userId)).toBe('new@example.com');
  });

  it('moves an unlinked subscription the user pays for onto the new address', async () => {
    const userId = await seedUser('old@example.com');
    stripeCustomers.emails.set('cus_payer', 'Old@Example.com');
    await seedSubscription('old@example.com', null, 'cus_payer');

    expect(await changeEmail(userId, 'new@example.com')).toEqual({
      changed: true,
    });

    expect(await subscriptions()).toEqual([
      { email: 'new@example.com', linked_email: null, active: true },
    ]);
    expect(stripeCustomers.emails.get('cus_payer')).toBe('new@example.com');
  });

  it('moves only the recipient column, with no Stripe call, when someone else pays', async () => {
    const userId = await seedUser('old@example.com', 'cus_someone');
    stripeCustomers.emails.set('cus_someone', 'payer@example.com');
    await seedSubscription('payer@example.com', 'Old@Example.com', 'cus_someone');

    expect(await changeEmail(userId, 'new@example.com')).toEqual({
      changed: true,
    });

    expect(await subscriptions()).toEqual([
      {
        email: 'payer@example.com',
        linked_email: 'new@example.com',
        active: true,
      },
    ]);
    expect(stripeCustomers.retrieve).not.toHaveBeenCalled();
    expect(stripeCustomers.update).not.toHaveBeenCalled();
  });

  it('moves both columns of a row the user both pays for and receives', async () => {
    const userId = await seedUser('old@example.com');
    stripeCustomers.emails.set('cus_self', 'old@example.com');
    await seedSubscription('old@example.com', 'old@example.com', 'cus_self');

    expect(await changeEmail(userId, 'new@example.com')).toEqual({
      changed: true,
    });

    expect(await subscriptions()).toEqual([
      { email: 'new@example.com', linked_email: 'new@example.com', active: true },
    ]);
    expect(stripeCustomers.emails.get('cus_self')).toBe('new@example.com');
  });

  it('updates every Stripe customer behind the rows the user pays for', async () => {
    const userId = await seedUser('old@example.com', 'cus_account');
    stripeCustomers.emails.set('cus_account', 'old@example.com');
    stripeCustomers.emails.set('cus_row', 'old@example.com');
    await seedSubscription('old@example.com', null, 'cus_row');

    expect(await changeEmail(userId, 'new@example.com')).toEqual({
      changed: true,
    });

    expect(stripeCustomers.emails.get('cus_account')).toBe('new@example.com');
    expect(stripeCustomers.emails.get('cus_row')).toBe('new@example.com');
  });

  it("never rewrites a Stripe customer whose email is someone else's", async () => {
    const userId = await seedUser('old@example.com', 'cus_someone');
    stripeCustomers.emails.set('cus_someone', 'payer@example.com');
    stripeCustomers.emails.set('cus_row', 'old@example.com');
    await seedSubscription('old@example.com', null, 'cus_row');

    expect(await changeEmail(userId, 'new@example.com')).toEqual({
      changed: true,
    });

    expect(stripeCustomers.emails.get('cus_someone')).toBe('payer@example.com');
    expect(stripeCustomers.emails.get('cus_row')).toBe('new@example.com');
  });

  it('refuses the change and touches nothing when Stripe fails', async () => {
    const userId = await seedUser('old@example.com');
    stripeCustomers.emails.set('cus_payer', 'old@example.com');
    stripeCustomers.failUpdate = true;
    await seedSubscription('old@example.com', null, 'cus_payer');

    const outcome = await changeEmail(userId, 'new@example.com');

    expect(outcome).toMatchObject({ changed: false });
    expect(await subscriptions()).toEqual([
      { email: 'old@example.com', linked_email: null, active: true },
    ]);
    expect(await signInEmail(userId)).toBe('old@example.com');
    expect(stripeCustomers.emails.get('cus_payer')).toBe('old@example.com');
  });

  it('puts the first Stripe customer back when a later one fails', async () => {
    const userId = await seedUser('old@example.com', 'cus_first');
    stripeCustomers.emails.set('cus_first', 'old@example.com');
    stripeCustomers.emails.set('cus_second', 'old@example.com');
    await seedSubscription('old@example.com', null, 'cus_second');
    let calls = 0;
    stripeCustomers.update.mockImplementation(() => {
      calls += 1;
      stripeCustomers.failUpdate = calls === 2;
    });

    const outcome = await changeEmail(userId, 'new@example.com');
    stripeCustomers.update.mockReset();

    expect(outcome).toMatchObject({ changed: false });
    expect(stripeCustomers.emails.get('cus_first')).toBe('old@example.com');
    expect(stripeCustomers.emails.get('cus_second')).toBe('old@example.com');
    expect(await signInEmail(userId)).toBe('old@example.com');
  });

  it('refuses a new address that already has a subscription row', async () => {
    const userId = await seedUser('old@example.com');
    stripeCustomers.emails.set('cus_payer', 'old@example.com');
    await seedSubscription('old@example.com', null, 'cus_payer');
    await seedSubscription('New@Example.com', null, 'cus_other');

    expect(await changeEmail(userId, 'new@example.com')).toEqual({
      changed: false,
      reason: takenReason,
    });

    expect(stripeCustomers.update).not.toHaveBeenCalled();
    expect(await signInEmail(userId)).toBe('old@example.com');
  });

  it('refuses a payer moving to an Apple Hide My Email address, touching nothing', async () => {
    const userId = await seedUser('old@example.com');
    stripeCustomers.emails.set('cus_payer', 'old@example.com');
    await seedSubscription('old@example.com', null, 'cus_payer');

    expect(
      await changeEmail(userId, 'abc123@PrivateRelay.AppleID.com')
    ).toEqual({ changed: false, reason: 'payer_relay_address' });

    expect(stripeCustomers.update).not.toHaveBeenCalled();
    expect(await signInEmail(userId)).toBe('old@example.com');
    expect(await subscriptions()).toEqual([
      { email: 'old@example.com', linked_email: null, active: true },
    ]);
  });

  it('lets a recipient move to an Apple Hide My Email address with no Stripe call', async () => {
    const userId = await seedUser('old@example.com');
    await seedSubscription('payer@example.com', 'old@example.com', 'cus_someone');

    expect(
      await changeEmail(userId, 'abc123@privaterelay.appleid.com')
    ).toEqual({ changed: true });

    expect(stripeCustomers.update).not.toHaveBeenCalled();
    expect(await subscriptions()).toEqual([
      {
        email: 'payer@example.com',
        linked_email: 'abc123@privaterelay.appleid.com',
        active: true,
      },
    ]);
  });

  it('moves a payer off an Apple Hide My Email address and updates Stripe', async () => {
    const userId = await seedUser('abc123@privaterelay.appleid.com');
    stripeCustomers.emails.set('cus_payer', 'abc123@privaterelay.appleid.com');
    await seedSubscription(
      'abc123@privaterelay.appleid.com',
      null,
      'cus_payer'
    );

    expect(await changeEmail(userId, 'real@example.com')).toEqual({
      changed: true,
    });

    expect(stripeCustomers.emails.get('cus_payer')).toBe('real@example.com');
    expect(await subscriptions()).toEqual([
      { email: 'real@example.com', linked_email: null, active: true },
    ]);
  });

  it('keeps one active row when the next subscription webhook carries the new email', async () => {
    const userId = await seedUser('old@example.com', 'cus_payer');
    stripeCustomers.emails.set('cus_payer', 'old@example.com');
    await seedSubscription('old@example.com', 'friend@example.com', 'cus_payer');
    await seedUser('friend@example.com');

    expect(await changeEmail(userId, 'new@example.com')).toEqual({
      changed: true,
    });
    await updateStoreSubscription(
      database,
      { id: 'cus_payer', email: 'new@example.com' } as StripeTypes.Customer,
      stripeSubscription('cus_payer')
    );

    expect(await subscriptions()).toEqual([
      {
        email: 'new@example.com',
        linked_email: 'friend@example.com',
        active: true,
      },
    ]);
  });
});

describe('an email change with no subscription', () => {
  it.each([
    ['confirmed', confirmChange],
    ['ops', opsChange],
  ] as const)(
    'moves a %s non-paying user to an Apple Hide My Email address with no Stripe call',
    async (_label, changeEmail) => {
      const userId = await seedUser('old@example.com', null);

      expect(
        await changeEmail(userId, 'abc123@privaterelay.appleid.com')
      ).toEqual({ changed: true });

      expect(await signInEmail(userId)).toBe('abc123@privaterelay.appleid.com');
      expect(stripeCustomers.retrieve).not.toHaveBeenCalled();
    }
  );
});
