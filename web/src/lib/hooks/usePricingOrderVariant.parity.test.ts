import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VARIANTS } from './usePricingOrderVariant';

function readServerPricingVariants(): string[] {
  const source = readFileSync(
    join(__dirname, '../../../../', 'src/usecases/checkout/pricingVariant.ts'),
    'utf8'
  );
  const set = /const VALID_PRICING_VARIANTS = new Set\(\[([\s\S]*?)\]/.exec(
    source
  );
  if (set == null) {
    throw new Error('VALID_PRICING_VARIANTS not found in server source');
  }
  return Array.from(set[1].matchAll(/'([a-z-]+)'/g), (m) => m[1]);
}

describe('pricing variant allowlist parity', () => {
  it('every variant the web can assign is accepted by the server allowlist', () => {
    const serverVariants = new Set(readServerPricingVariants());
    const dropped = VARIANTS.filter((variant) => !serverVariants.has(variant));
    expect(dropped).toEqual([]);
  });

  it('accepts no server variant the web does not know', () => {
    const serverVariants = readServerPricingVariants();
    const unknown = serverVariants.filter(
      (variant) => !(VARIANTS as string[]).includes(variant)
    );
    expect(unknown).toEqual([]);
  });
});
