import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startUnlimitedCheckout = vi.fn();

vi.mock('./get2ankiApi', () => ({
  get2ankiApi: () => ({ startUnlimitedCheckout }),
}));

import { startUnlimitedUpgrade } from './startUnlimitedUpgrade';

function stubLocation() {
  const location = { href: '' };
  vi.stubGlobal('location', location);
  return location;
}

describe('startUnlimitedUpgrade', () => {
  beforeEach(() => {
    startUnlimitedCheckout.mockReset();
    vi.unstubAllGlobals();
  });

  it('creates the session through the API so it carries the buyer identity', async () => {
    startUnlimitedCheckout.mockResolvedValue({ url: 'https://stripe/session' });
    const location = stubLocation();

    await startUnlimitedUpgrade('limit-wall');

    expect(startUnlimitedCheckout).toHaveBeenCalledWith(
      'month',
      undefined,
      'limit-wall'
    );
    expect(location.href).toBe('https://stripe/session');
  });

  it('falls back to the pricing page when the session cannot be created', async () => {
    startUnlimitedCheckout.mockResolvedValue({ status: 'error' });
    const location = stubLocation();

    await startUnlimitedUpgrade('limit-wall');

    expect(location.href).toBe('/pricing?source=limit-wall');
  });

  it('encodes the surface it was given', async () => {
    startUnlimitedCheckout.mockResolvedValue({ status: 'unavailable' });
    const location = stubLocation();

    await startUnlimitedUpgrade('downloads limit');

    expect(location.href).toBe('/pricing?source=downloads%20limit');
  });
});

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe('static Stripe payment links', () => {
  it('are not referenced anywhere in the web app', () => {
    const offenders = collectSourceFiles(join(process.cwd(), 'src')).filter(
      (file) =>
        readFileSync(file, 'utf8').includes('buy.stripe.com') &&
        !file.endsWith('startUnlimitedUpgrade.test.ts')
    );

    expect(offenders).toEqual([]);
  });
});
