import knex, { Knex } from 'knex';

import { payerAddressIsProven } from './payerAddressProof';

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
      t.text('payload').nullable();
      t.text('created_at').nullable();
    });
    await database.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
      t.boolean('email_verified').notNullable().defaultTo(false);
      t.text('created_at').nullable();
    });
  });

  afterEach(async () => {
    await database.destroy();
  });

  const addRow = (fields: {
    linked_email?: string | null;
    metadataUserId?: string;
    created_at?: string | null;
  }) =>
    database('subscriptions').insert({
      email: ADDRESS,
      linked_email: fields.linked_email ?? null,
      created_at:
        fields.created_at === undefined ? SUBSCRIBED : fields.created_at,
      payload: JSON.stringify({
        id: 'sub_1',
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

  it('holds for an unverified account the checkout named, even on a linked row', async () => {
    const id = await addAccount(false, AFTER);
    await addRow({ linked_email: OWNER_ADDRESS, metadataUserId: String(id) });

    await expect(payerAddressIsProven(database, ADDRESS)).resolves.toBe(true);
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
});
