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

const checkoutAccountId = (payload: unknown): string | null => {
  let parsed = payload;
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  const id = (parsed as { metadata?: { user_id?: unknown } } | null)?.metadata
    ?.user_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

const predates = (
  earlier: Date | string | null,
  later: Date | string | null
): boolean =>
  earlier != null &&
  later != null &&
  new Date(earlier).getTime() <= new Date(later).getTime();

const accountOwnsPayerRow = (
  account: PayerAddressAccount,
  row: PayerRow,
  address: string
): boolean => {
  if (account.email_verified) {
    return true;
  }
  const checkoutAccount = checkoutAccountId(row.payload);
  if (checkoutAccount != null) {
    return checkoutAccount === String(account.id);
  }
  const linkedEmail = row.linked_email?.toLowerCase().trim();
  if (linkedEmail != null && linkedEmail !== address) {
    return false;
  }
  return predates(account.created_at, row.created_at);
};

// Signup does not verify an address, so an account sitting on a payer's address
// proves nothing by itself. subscriptions.email is one row per address, so this
// answers for every plan paid from it. An address with no row, or with no
// account, has nobody to doubt: ops, the sweeps and a Stripe lookup for a row
// that drifted all pass through.
export const payerAddressIsProven = async (
  db: Knex,
  email: string
): Promise<boolean> => {
  const address = email.toLowerCase().trim();
  const row: PayerRow | undefined = await db('subscriptions')
    .where({ email: address })
    .select('linked_email', 'created_at', 'payload')
    .first();
  if (row == null) {
    return true;
  }
  const account: PayerAddressAccount | undefined = await db('users')
    .whereRaw('lower(trim(email)) = ?', [address])
    .orderBy('created_at', 'asc')
    .select('id', 'email_verified', 'created_at')
    .first();
  return account == null || accountOwnsPayerRow(account, row, address);
};
