import type { Knex } from 'knex';

interface PayerRow {
  linked_email: string | null;
  created_at: Date | string | null;
  payload: unknown;
}

interface PayerAddressAccount {
  id: number;
  email_verified: boolean | number;
  created_at: Date | string | null;
}

interface StripePayload {
  created?: unknown;
  metadata?: { user_id?: unknown };
}

const readPayload = (payload: unknown): StripePayload | null => {
  if (typeof payload !== 'string') {
    return payload as StripePayload | null;
  }
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

const checkoutAccountId = (row: PayerRow): string | null => {
  const id = readPayload(row.payload)?.metadata?.user_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

// The row's own date alone would not do: a deleted row comes back dated today.
const planStartedAt = (row: PayerRow): number => {
  const created = readPayload(row.payload)?.created;
  const dates = [
    row.created_at == null ? Number.NaN : new Date(row.created_at).getTime(),
    typeof created === 'number' ? created * 1000 : Number.NaN,
  ].filter(Number.isFinite);
  return dates.length > 0 ? Math.min(...dates) : Number.NaN;
};

const predatesPlan = (account: PayerAddressAccount, row: PayerRow): boolean =>
  account.created_at != null &&
  new Date(account.created_at).getTime() <= planStartedAt(row);

const belongsToAnotherAccount = (
  account: PayerAddressAccount,
  row: PayerRow,
  address: string
): boolean => {
  const linkedEmail = row.linked_email?.toLowerCase().trim();
  if (linkedEmail != null && linkedEmail !== address) {
    return true;
  }
  const checkoutAccount = checkoutAccountId(row);
  return checkoutAccount != null && checkoutAccount !== String(account.id);
};

const readPayerRow = (
  db: Knex,
  address: string
): Promise<PayerRow | undefined> =>
  db('subscriptions')
    .where({ email: address })
    .select('linked_email', 'created_at', 'payload')
    .first();

const readAccount = (
  db: Knex,
  address: string
): Promise<PayerAddressAccount | undefined> =>
  db('users')
    .whereRaw('lower(trim(email)) = ?', [address])
    .orderBy('id', 'asc')
    .select('id', 'email_verified', 'created_at')
    .first();

const normalizeAddress = (email: string): string => email.toLowerCase().trim();

// Signup does not verify an address, so an account sitting on a payer's address
// proves nothing by itself. subscriptions.email is one row per address, so this
// answers for every plan paid from it. A checkout that named the account proves
// that purchase, and a purchase is not proof of the address, so
// stripeAddressIsOpen leaves it out.
export const payerAddressIsProven = async (
  db: Knex,
  email: string
): Promise<boolean> => {
  const address = normalizeAddress(email);
  const row = await readPayerRow(db, address);
  if (row == null) {
    return true;
  }
  const account = await readAccount(db, address);
  if (account == null || account.email_verified) {
    return true;
  }
  if (belongsToAnotherAccount(account, row, address)) {
    return false;
  }
  return (
    checkoutAccountId(row) === String(account.id) || predatesPlan(account, row)
  );
};

// Stripe lists every customer on an address, whoever's plan they carry, so this
// is stricter: with no row to read, an unverified account has shown nothing.
// An address with no account has nobody to doubt: the sweeps pass through.
export const stripeAddressIsOpen = async (
  db: Knex,
  email: string
): Promise<boolean> => {
  const address = normalizeAddress(email);
  const account = await readAccount(db, address);
  if (account == null || account.email_verified) {
    return true;
  }
  const row = await readPayerRow(db, address);
  return (
    row != null &&
    !belongsToAnotherAccount(account, row, address) &&
    predatesPlan(account, row)
  );
};

export const holdsUnprovenPlan = async (
  db: Knex,
  email: string
): Promise<boolean> => {
  const address = normalizeAddress(email);
  const activeRow = await db('subscriptions')
    .where({ email: address, active: true })
    .select('email')
    .first();
  return activeRow != null && !(await payerAddressIsProven(db, address));
};
