import { PricingService, PASS_PRICE_KINDS } from './PricingService';

interface FakePrice {
  id: string;
  unit_amount: number | null;
  currency: string;
  created: number;
}

const makeStripe = (searchImpl: jest.Mock) =>
  ({ prices: { search: searchImpl } }) as never;

const price = (over: Partial<FakePrice> = {}): FakePrice => ({
  id: 'price_default',
  unit_amount: 600,
  currency: 'usd',
  created: 1000,
  ...over,
});

describe('PricingService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.PASS_24H_PRICE_ID;
    delete process.env.PASS_7D_PRICE_ID;
    delete process.env.PASS_120D_PRICE_ID;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('resolves the active price for a pass kind by its metadata', async () => {
    const search = jest.fn().mockResolvedValue({
      data: [price({ id: 'price_24h', unit_amount: 600, currency: 'usd' })],
    });
    const service = new PricingService(makeStripe(search));

    const resolved = await service.resolve('24h');

    expect(resolved).toEqual({
      kind: '24h',
      priceId: 'price_24h',
      amount: 600,
      currency: 'usd',
      source: 'stripe',
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("metadata['2anki_pass_kind']:'24h'"),
      })
    );
    expect(search.mock.calls[0][0].query).toContain("active:'true'");
  });

  it('picks the newest active price and warns when more than one matches', async () => {
    const warn = jest.spyOn(console, 'warn');
    const search = jest.fn().mockResolvedValue({
      data: [
        price({ id: 'price_old', created: 1000, unit_amount: 500 }),
        price({ id: 'price_new', created: 2000, unit_amount: 700 }),
      ],
    });
    const service = new PricingService(makeStripe(search));

    const resolved = await service.resolve('7d');

    expect(resolved.priceId).toBe('price_new');
    expect(resolved.amount).toBe(700);
    expect(warn).toHaveBeenCalledWith(
      'pricing.pass.multiple_active',
      expect.objectContaining({ kind: '7d', count: 2 })
    );
  });

  it('serves the cached result within the TTL without calling Stripe again', async () => {
    jest.useFakeTimers();
    const search = jest.fn().mockResolvedValue({
      data: [price({ id: 'price_120d' })],
    });
    const service = new PricingService(makeStripe(search));

    await service.resolve('120d');
    jest.advanceTimersByTime(4 * 60 * 1000);
    await service.resolve('120d');

    expect(search).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('re-resolves from Stripe once the 5-minute TTL has elapsed', async () => {
    jest.useFakeTimers();
    const search = jest.fn().mockResolvedValue({
      data: [price({ id: 'price_120d' })],
    });
    const service = new PricingService(makeStripe(search));

    await service.resolve('120d');
    jest.advanceTimersByTime(5 * 60 * 1000 + 1);
    await service.resolve('120d');

    expect(search).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('serves the last-known-good result when Stripe fails after a prior success', async () => {
    jest.useFakeTimers();
    const search = jest
      .fn()
      .mockResolvedValueOnce({ data: [price({ id: 'price_24h_good' })] })
      .mockRejectedValueOnce(new Error('stripe down'));
    const service = new PricingService(makeStripe(search));

    const first = await service.resolve('24h');
    jest.advanceTimersByTime(6 * 60 * 1000);
    const second = await service.resolve('24h');

    expect(first.source).toBe('stripe');
    expect(second.priceId).toBe('price_24h_good');
    expect(second.source).toBe('cache');
    jest.useRealTimers();
  });

  it('falls back to the env price id on a cold start with no prior success', async () => {
    process.env.PASS_24H_PRICE_ID = 'price_env_24h';
    const search = jest.fn().mockRejectedValue(new Error('stripe down'));
    const service = new PricingService(makeStripe(search));

    const resolved = await service.resolve('24h');

    expect(resolved).toEqual({
      kind: '24h',
      priceId: 'price_env_24h',
      amount: null,
      currency: null,
      source: 'env',
    });
  });

  it('returns a null price id when Stripe, cache, and env are all unavailable', async () => {
    const search = jest.fn().mockRejectedValue(new Error('stripe down'));
    const service = new PricingService(makeStripe(search));

    const resolved = await service.resolve('7d');

    expect(resolved.priceId).toBeNull();
    expect(resolved.source).toBe('none');
  });

  it('falls back to env when the Stripe search returns no matching price', async () => {
    process.env.PASS_120D_PRICE_ID = 'price_env_120d';
    const search = jest.fn().mockResolvedValue({ data: [] });
    const service = new PricingService(makeStripe(search));

    const resolved = await service.resolve('120d');

    expect(resolved.priceId).toBe('price_env_120d');
    expect(resolved.source).toBe('env');
  });

  it('resolvePriceId returns just the price id string', async () => {
    const search = jest.fn().mockResolvedValue({
      data: [price({ id: 'price_7d' })],
    });
    const service = new PricingService(makeStripe(search));

    expect(await service.resolvePriceId('7d')).toBe('price_7d');
  });

  it('resolveAll resolves every pass kind', async () => {
    const search = jest.fn().mockImplementation((params: { query: string }) => {
      const kind = PASS_PRICE_KINDS.find((k) =>
        params.query.includes(`:'${k}'`)
      );
      return Promise.resolve({
        data: [price({ id: `price_${kind}`, unit_amount: 100 })],
      });
    });
    const service = new PricingService(makeStripe(search));

    const all = await service.resolveAll();

    expect(all.map((r) => r.kind)).toEqual(['24h', '7d', '120d']);
    expect(all.map((r) => r.priceId)).toEqual([
      'price_24h',
      'price_7d',
      'price_120d',
    ]);
  });

  it('coalesces concurrent cold-cache resolutions into one Stripe call', async () => {
    const search = jest.fn().mockResolvedValue({
      data: [price({ id: 'price_24h_coalesced' })],
    });
    const service = new PricingService(makeStripe(search));
    const [a, b, c] = await Promise.all([
      service.resolve('24h'),
      service.resolve('24h'),
      service.resolve('24h'),
    ]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(a.priceId).toBe(b.priceId);
    expect(b.priceId).toBe(c.priceId);
  });
});
