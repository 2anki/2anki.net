import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_UNLIMITED_PRICING } from './pages/PricingPage/pricing.constants';

const indexHtml = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');

function extractSoftwareApplicationSchema(): {
  offers: Array<{ name: string; price: string }>;
} {
  const blocks = [
    ...indexHtml.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
    ),
  ].map((m) => JSON.parse(m[1]));
  const app = blocks.find((b) => b['@type'] === 'SoftwareApplication');
  if (app == null) throw new Error('SoftwareApplication schema missing');
  return app;
}

describe('index.html SoftwareApplication schema', () => {
  it('advertises the live Unlimited prices, not a stale ramp', () => {
    const { offers } = extractSoftwareApplicationSchema();
    const monthly = offers.find((o) => o.name === 'Unlimited');
    expect(monthly?.price).toBe(
      (LEGACY_UNLIMITED_PRICING.monthlyCents / 100).toFixed(2)
    );
    const annual = offers.find((o) => o.name === 'Unlimited (annual)');
    expect(annual?.price).toBe(
      String(LEGACY_UNLIMITED_PRICING.annualCents / 100)
    );
  });

  it('does not offer plans that cannot be purchased', () => {
    const { offers } = extractSoftwareApplicationSchema();
    expect(offers.map((o) => o.name)).not.toContain('Auto Sync');
  });

  it('lists the pass and lifetime offers at their card prices', () => {
    const { offers } = extractSoftwareApplicationSchema();
    expect(offers.find((o) => o.name === 'Day Pass')?.price).toBe('4');
    expect(offers.find((o) => o.name === 'Week Pass')?.price).toBe('9');
    expect(offers.find((o) => o.name === 'Lifetime')?.price).toBe('345');
  });
});
