export const PURCHASE_BLOCK_CODES = [
  'already_lifetime',
  'already_unlimited',
  'already_subscribed',
  'billed_through_apple',
  'pass_still_active',
] as const;

export type PurchaseBlockCode = (typeof PURCHASE_BLOCK_CODES)[number];

export interface CheckoutConflict {
  status: 'conflict';
  code: PurchaseBlockCode;
  expiresAt: string | null;
}

export function isPurchaseBlockCode(
  value: unknown
): value is PurchaseBlockCode {
  return (
    typeof value === 'string' &&
    (PURCHASE_BLOCK_CODES as readonly string[]).includes(value)
  );
}

export async function readCheckoutConflict(
  response: Response
): Promise<CheckoutConflict | null> {
  const body = (await response.json().catch(() => null)) as {
    code?: unknown;
    expiresAt?: unknown;
  } | null;
  if (body == null || !isPurchaseBlockCode(body.code)) {
    return null;
  }
  const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt : null;
  return { status: 'conflict', code: body.code, expiresAt };
}
