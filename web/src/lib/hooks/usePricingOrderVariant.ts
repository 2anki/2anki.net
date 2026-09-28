import { useState } from 'react';

export type PricingOrder =
  | 'passes-first'
  | 'unlimited-first'
  | 'minimal'
  | 'semester-first';

const VARIANTS: PricingOrder[] = [
  'passes-first',
  'unlimited-first',
  'minimal',
  'semester-first',
];

/**
 * The live 50/50 test, started 2026-09-28: `minimal` (the order the previous
 * test concluded on) against `semester-first` (the Semester Pass leads the
 * pass row with the featured treatment). A stored assignment outside this
 * pair is a leftover from the concluded order test and is reassigned.
 */
const ACTIVE_TEST: readonly PricingOrder[] = ['minimal', 'semester-first'];

const STORAGE_KEY = 'pricing_order_variant';

function isPricingOrder(value: unknown): value is PricingOrder {
  return typeof value === 'string' && (VARIANTS as string[]).includes(value);
}

/** `?variant=` forces a layout for QA without persisting. */
function readOverride(): PricingOrder | null {
  try {
    const value = new URLSearchParams(globalThis.location?.search ?? '').get(
      'variant'
    );
    return isPricingOrder(value) ? value : null;
  } catch {
    return null;
  }
}

function readAssignment(): PricingOrder | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isPricingOrder(value) && ACTIVE_TEST.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function assign(): PricingOrder {
  const [byte] = globalThis.crypto.getRandomValues(new Uint8Array(1));
  const variant = ACTIVE_TEST[byte % ACTIVE_TEST.length];
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, variant);
  } catch {
    // Storage unavailable (private mode, SSR) — the visitor is re-bucketed
    // next visit, which is fine for a layout test.
  }
  return variant;
}

export function usePricingOrderVariant(): PricingOrder {
  const [variant] = useState<PricingOrder>(
    () => readOverride() ?? readAssignment() ?? assign()
  );

  return variant;
}
