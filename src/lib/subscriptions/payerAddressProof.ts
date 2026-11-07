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
  customer?: unknown;
  status?: unknown;
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

export const planCustomerId = (
  row: { payload?: unknown } | undefined
): string | null => {
  const customer = readPayload(row?.payload)?.customer;
  return typeof customer === 'string' && customer.length > 0 ? customer : null;
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
// that purchase, not the address: accountOwnsAddress leaves it out.
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

// Whether the customer stored on this account leaves the address with it. With
// no row, an unverified account has shown nothing, and a customer it carried
// away would keep billing under this address.
export const storedCustomerFollowsAccount = async (
  db: Knex,
  email: string
): Promise<boolean> => {
  const address = normalizeAddress(email);
  const account = await readAccount(db, address);
  if (account == null || account.email_verified) {
    return true;
  }
  const row = await readPayerRow(db, address);
  return row != null && (await payerAddressIsProven(db, address));
};

export interface StripeReach {
  byAddress: boolean;
  customerId: string | null;
}

// Stripe lists every customer on an address, whoever's plan they carry, so only
// a verified address opens that search. An unverified account reaches the one
// customer stored on it, on an address it can prove, which covers a plan of its
// own without showing it anyone else's. Older rows predate the stored column,
// so the plan's own customer stands in.
export const stripeReachOf = async (
  db: Knex,
  email: string
): Promise<StripeReach> => {
  const address = normalizeAddress(email);
  const account = await readAccount(db, address);
  if (account == null || account.email_verified) {
    return { byAddress: true, customerId: null };
  }
  if (!(await payerAddressIsProven(db, address))) {
    return { byAddress: false, customerId: null };
  }
  const stored = await db('users')
    .where({ id: account.id })
    .select('stripe_customer_id')
    .first();
  const row = await readPayerRow(db, address);
  return {
    byAddress: false,
    customerId: stored?.stripe_customer_id ?? planCustomerId(row) ?? null,
  };
};

const ENDED_STATUSES: ReadonlySet<string> = new Set([
  'canceled',
  'incomplete_expired',
]);

export const isEndedStatus = (status: string): boolean =>
  ENDED_STATUSES.has(status);

// A paused or past-due plan stores active = false and is still open in Stripe.
const isOpenPlan = (row: PayerRow & { active: unknown }): boolean => {
  const status = readPayload(row.payload)?.status;
  return (
    Boolean(row.active) ||
    (typeof status === 'string' && !ENDED_STATUSES.has(status))
  );
};

// True when a checkout from this account would write over a row it cannot use:
// an open plan, or one that stays linked to someone else after this purchase.
export const holdsUnprovenPlan = async (
  db: Knex,
  email: string
): Promise<boolean> => {
  const address = normalizeAddress(email);
  const row = await db('subscriptions')
    .where({ email: address })
    .select('active', 'linked_email', 'created_at', 'payload')
    .first();
  if (row == null || (await payerAddressIsProven(db, address))) {
    return false;
  }
  const linkedEmail = row.linked_email?.toLowerCase().trim();
  return isOpenPlan(row) || (linkedEmail != null && linkedEmail !== address);
};
