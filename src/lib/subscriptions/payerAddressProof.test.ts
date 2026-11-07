import knex, { Knex } from 'knex';

import {
  holdsUnprovenPlan,
  isLockedOutOfPlan,
  payerAddressIsProven,
  accountHoldsAddress,
  stripeReachOf,
} from './payerAddressProof';

const ADDRESS = 'payer@example.com';
const OWNER_ADDRESS = 'owner@example.com';
const BEFORE = '2026-01-01T00:00:00.000Z';
const SUBSCRIBED = '2026-02-01T00:00:00.000Z';
const AFTER = '2026-03-01T00:00:00.000Z';

describe('payerAddressIsProven', () => {
  let database: Knex;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await database.schema.createTable('subscriptions', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
      t.text('linked_email').nullable();
      t.boolean('active').notNullable().defaultTo(false);
      t.text('payload').nullable();
      t.text('created_at').nullable();
    });
    await database.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
      t.boolean('email_verified').notNullable().defaultTo(false);
      t.text('created_at').nullable();
      t.text('stripe_customer_id').nullable();
    });
  });

  afterEach(async () => {
    await database.destroy();
  });

  const addRow = (fields: {
    linked_email?: string | null;
    metadataUserId?: string;
    created_at?: string | null;
    active?: boolean;
    stripeCreated?: number;
    status?: string;
  }) =>
    database('subscriptions').insert({
      email: ADDRESS,
      linked_email: fields.linked_email ?? null,
      active: fields.active ?? false,
      created_at:
        fields.created_at === undefined ? SUBSCRIBED : fields.created_at,
      payload: JSON.stringify({
        id: 'sub_1',
        created: fields.stripeCreated,
        status: fields.status,
        metadata:
          fields.metadataUserId == null
            ? {}
            : { user_id: fields.metadataUserId },
      }),
    });

  const addAccount = async (
    verified: boolean,
    created_at: string | null,
    email = ADDRESS
  ): Promise<number> => {
    const [id] = await database('users').insert({
      email,
      email_verified: verified,
      created_at,
    });
    return id;
  };

  it('holds when the address has no subscription row', async () => {
    await addAccount(false, AFTER);

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(true);
  });

  it('holds when no account sits on the address', async () => {
    await addRow({});

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(true);
  });

  it('holds for a verified account signed up after the subscription', async () => {
    await addRow({});
    await addAccount(true, AFTER);

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(true);
  });

  it('holds for a verified account on a row linked to someone else', async () => {
    await addRow({ linked_email: OWNER_ADDRESS });
    await addAccount(true, AFTER);

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(true);
  });

  it('fails for an unverified account on a row linked to someone else', async () => {
    await addRow({ linked_email: OWNER_ADDRESS });
    await addAccount(false, BEFORE);

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(false);
  });

  it('holds for an unverified account that predates an unlinked subscription', async () => {
    await addRow({});
    await addAccount(false, BEFORE);

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(true);
  });

  it('fails for an unverified account newer than an unlinked subscription', async () => {
    await addRow({});
    await addAccount(false, AFTER);

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(false);
  });

  it('holds for an unverified account the checkout named on an unlinked row', async () => {
    const id = await addAccount(false, AFTER);
    await addRow({ metadataUserId: String(id) });

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(true);
  });

  it('fails for a checkout of its own on a row linked to someone else', async () => {
    const id = await addAccount(false, AFTER);
    await addRow({ linked_email: OWNER_ADDRESS, metadataUserId: String(id) });

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(false);
  });

  it('fails for an older unverified account when the checkout named another', async () => {
    const id = await addAccount(false, BEFORE);
    await addRow({ metadataUserId: String(id + 1) });

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(false);
  });

  it('fails when the row has no date to compare', async () => {
    await addRow({ created_at: null });
    await addAccount(false, BEFORE);

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(false);
  });

  it('matches the address whatever its case or padding', async () => {
    await addRow({ linked_email: OWNER_ADDRESS });
    await addAccount(false, AFTER, ' Payer@Example.com ');

    await expect(
      payerAddressIsProven(database, 'PAYER@example.com')
    ).resolves.toBe(false);
  });

  it('dates a plan by Stripe when the row came back later', async () => {
    await addRow({
      created_at: AFTER,
      stripeCreated: new Date(BEFORE).getTime() / 1000,
    });
    await addAccount(false, SUBSCRIBED);

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(false);
  });

  it('reads the object and Date a Postgres driver returns', async () => {
    const row = {
      linked_email: null,
      created_at: new Date(SUBSCRIBED),
      payload: { created: 1_767_225_600, metadata: { user_id: '7' } },
    };
    const account = {
      id: 7,
      email_verified: false,
      created_at: new Date(AFTER),
    };
    const stubbed = ((table: string) => {
      const first = async () => (table === 'users' ? account : row);
      const chain = {
        where: () => chain,
        whereRaw: () => chain,
        orderBy: () => chain,
        select: () => chain,
        first,
      };
      return chain;
    }) as unknown as Knex;

    await expect(payerAddressIsProven(stubbed, ADDRESS)).resolves.toBe(true);
    await expect(stripeReachOf(stubbed, ADDRESS)).resolves.toMatchObject({
      byAddress: false,
    });
  });

  describe('accountHoldsAddress', () => {
    it('follows when no account sits on the address', async () => {
      await expect(accountHoldsAddress(database, ADDRESS)).resolves.toBe(true);
    });

    it('follows a verified account with no row', async () => {
      await addAccount(true, AFTER);

      await expect(accountHoldsAddress(database, ADDRESS)).resolves.toBe(true);
    });

    it('stays behind for an unverified account with no row', async () => {
      await addAccount(false, BEFORE);

      await expect(accountHoldsAddress(database, ADDRESS)).resolves.toBe(false);
    });

    it('follows an unverified account on a row it can prove', async () => {
      await addRow({});
      await addAccount(false, BEFORE);

      await expect(accountHoldsAddress(database, ADDRESS)).resolves.toBe(true);
    });

    it('stays behind on a row linked to someone else', async () => {
      await addRow({ linked_email: OWNER_ADDRESS });
      await addAccount(false, BEFORE);

      await expect(accountHoldsAddress(database, ADDRESS)).resolves.toBe(false);
    });
  });

  describe('stripeReachOf', () => {
    it('searches the address for a verified account', async () => {
      await addAccount(true, AFTER);

      await expect(stripeReachOf(database, ADDRESS)).resolves.toEqual({
        accountId: expect.any(Number),
        byAddress: true,
        customerId: null,
      });
    });

    it('searches the address when no account sits on it', async () => {
      await expect(stripeReachOf(database, ADDRESS)).resolves.toEqual({
        accountId: null,
        byAddress: true,
        customerId: null,
      });
    });

    it('gives an unverified account only its stored customer', async () => {
      const id = await addAccount(false, BEFORE);
      await addRow({});
      await database('users')
        .where({ id })
        .update({ stripe_customer_id: 'cus_own' });

      await expect(stripeReachOf(database, ADDRESS)).resolves.toEqual({
        accountId: id,
        byAddress: false,
        customerId: 'cus_own',
      });
    });

    it('gives an unverified account nothing on an address it cannot prove', async () => {
      const id = await addAccount(false, AFTER);
      await addRow({ linked_email: OWNER_ADDRESS });
      await database('users')
        .where({ id })
        .update({ stripe_customer_id: 'cus_stamped' });

      await expect(stripeReachOf(database, ADDRESS)).resolves.toEqual({
        accountId: id,
        byAddress: false,
        customerId: null,
      });
    });
  });

  describe('isLockedOutOfPlan', () => {
    it('is true for an active plan the account cannot use', async () => {
      await addRow({ active: true, status: 'active' });
      await addAccount(false, AFTER);

      await expect(isLockedOutOfPlan(database, ADDRESS)).resolves.toBe(true);
    });

    it('is false for an unverified account older than its plan', async () => {
      await addRow({ active: true, status: 'active' });
      await addAccount(false, BEFORE);

      await expect(isLockedOutOfPlan(database, ADDRESS)).resolves.toBe(false);
    });

    it('is false for an unverified account the checkout named', async () => {
      const id = await addAccount(false, AFTER);
      await addRow({
        active: true,
        status: 'active',
        metadataUserId: String(id),
      });

      await expect(isLockedOutOfPlan(database, ADDRESS)).resolves.toBe(false);
    });

    it('reads no pass, lifetime or Auto Sync access, only subscription rows', async () => {
      await addRow({ active: true, status: 'active' });
      await addAccount(false, AFTER);
      await database.schema.alterTable('users', (t) => {
        t.boolean('patreon').defaultTo(true);
        t.boolean('ankify_access').defaultTo(true);
      });

      await expect(isLockedOutOfPlan(database, ADDRESS)).resolves.toBe(true);
    });

    it('is false when another live plan is linked to the account', async () => {
      await addRow({ active: true, status: 'active' });
      await addAccount(false, AFTER);
      await database('subscriptions').insert({
        email: 'other-payer@example.com',
        linked_email: ADDRESS,
        active: true,
      });

      await expect(isLockedOutOfPlan(database, ADDRESS)).resolves.toBe(false);
    });
  });

  describe('holdsUnprovenPlan', () => {
    it('finds a live plan the account has not proven', async () => {
      await addRow({ linked_email: OWNER_ADDRESS, active: true });
      await addAccount(false, AFTER);

      await expect(holdsUnprovenPlan(database, ADDRESS)).resolves.toBe(true);
    });

    it('finds a past-due plan, which stores active false', async () => {
      await addRow({ active: false, status: 'past_due' });
      await addAccount(false, AFTER);

      await expect(holdsUnprovenPlan(database, ADDRESS)).resolves.toBe(true);
    });

    it('finds an ended plan that stays linked to someone else', async () => {
      await addRow({
        linked_email: OWNER_ADDRESS,
        active: false,
        status: 'canceled',
      });
      await addAccount(false, AFTER);

      await expect(holdsUnprovenPlan(database, ADDRESS)).resolves.toBe(true);
    });

    it('ignores an ended unlinked plan, which a new checkout takes over', async () => {
      await addRow({ active: false, status: 'canceled' });
      await addAccount(false, AFTER);

      await expect(holdsUnprovenPlan(database, ADDRESS)).resolves.toBe(false);
    });

    it('ignores a plan the account has proven', async () => {
      await addRow({ linked_email: OWNER_ADDRESS, active: true });
      await addAccount(true, AFTER);

      await expect(holdsUnprovenPlan(database, ADDRESS)).resolves.toBe(false);
    });
  });
});
