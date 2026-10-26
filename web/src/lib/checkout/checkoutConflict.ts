export const PURCHASE_BLOCK_CODES = [
  'already_lifetime',
  'already_unlimited',
  'already_subscribed',
  'billed_through_apple',
  'pass_still_active',
  'lapsed_subscription',
  'currency_conflict',
] as const;

export type PurchaseBlockCode = (typeof PURCHASE_BLOCK_CODES)[number];

// The person's earlier plan whose last payment failed. Stripe still holds it
// open, so they choose: pay it (payUrl) or end it and switch.
export interface LapsedPlan {
  amount: number | null;
  currency: string;
  interval: 'month' | 'year' | null;
  payUrl: string | null;
}

export interface CheckoutConflict {
  status: 'conflict';
  code: PurchaseBlockCode;
  expiresAt: string | null;
  lapsedPlan?: LapsedPlan;
}

function readLapsedPlan(value: unknown): LapsedPlan | undefined {
  if (value == null || typeof value !== 'object') {
    return undefined;
  }
  const plan = value as Record<string, unknown>;
  if (typeof plan.currency !== 'string') {
    return undefined;
  }
  return {
    amount: typeof plan.amount === 'number' ? plan.amount : null,
    currency: plan.currency,
    interval:
      plan.interval === 'month' || plan.interval === 'year'
        ? plan.interval
        : null,
    payUrl: typeof plan.payUrl === 'string' ? plan.payUrl : null,
  };
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
    lapsedPlan?: unknown;
  } | null;
  if (body == null || !isPurchaseBlockCode(body.code)) {
    return null;
  }
  const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt : null;
  const lapsedPlan = readLapsedPlan(body.lapsedPlan);
  return {
    status: 'conflict',
    code: body.code,
    expiresAt,
    ...(lapsedPlan == null ? {} : { lapsedPlan }),
  };
}
