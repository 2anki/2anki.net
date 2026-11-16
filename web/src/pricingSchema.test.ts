import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_UNLIMITED_PRICING } from './pages/PricingPage/pricing.constants';
import { FALLBACK_PASS_PRICES } from './pages/PricingPage/payment.links';

const indexHtml = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');

function extractSoftwareApplicationSchema(): {
  offers: Array<{ name: string; price: string }>;
  featureList: string[];
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
  it('advertises the live Pro prices, not a stale ramp', () => {
    const { offers } = extractSoftwareApplicationSchema();
    const monthly = offers.find((o) => o.name === 'Pro');
    expect(monthly?.price).toBe(
      (LEGACY_UNLIMITED_PRICING.monthlyCents / 100).toFixed(2)
    );
    const annual = offers.find((o) => o.name === 'Pro (annual)');
    expect(annual?.price).toBe(
      String(LEGACY_UNLIMITED_PRICING.annualCents / 100)
    );
  });

  it('does not offer plans that cannot be purchased', () => {
    const { offers } = extractSoftwareApplicationSchema();
    expect(offers.map((o) => o.name)).not.toContain('Auto Sync');
    expect(offers.map((o) => o.name)).not.toContain('Lifetime');
  });

  it('lists no Auto Sync feature while the plan is not on sale', () => {
    const { featureList } = extractSoftwareApplicationSchema();
    expect(featureList.length).toBeGreaterThan(0);
    expect(featureList.filter((f) => f.includes('Auto Sync'))).toEqual([]);
  });

  it.each([
    ['Day Pass', '24h'],
    ['Week Pass', '7d'],
    ['Semester Pass', '120d'],
  ] as const)('lists the %s offer at its card price', (name, kind) => {
    const { offers } = extractSoftwareApplicationSchema();
    expect(offers.find((o) => o.name === name)?.price).toBe(
      FALLBACK_PASS_PRICES[kind].replace('$', '')
    );
  });
});
