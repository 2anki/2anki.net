import { GetPassPricingUseCase } from './GetPassPricingUseCase';
import type {
  PricingService,
  ResolvedPassPrice,
} from '../../services/PricingService';

const makeService = (records: ResolvedPassPrice[]): PricingService =>
  ({
    resolveAll: jest.fn().mockResolvedValue(records),
  }) as unknown as PricingService;

describe('GetPassPricingUseCase', () => {
  it('maps resolved prices into the pass pricing response with a display string', async () => {
    const service = makeService([
      {
        kind: '24h',
        priceId: 'p1',
        amount: 600,
        currency: 'usd',
        source: 'stripe',
      },
      {
        kind: '7d',
        priceId: 'p2',
        amount: 1200,
        currency: 'usd',
        source: 'stripe',
      },
      {
        kind: '120d',
        priceId: 'p3',
        amount: 2900,
        currency: 'usd',
        source: 'stripe',
      },
    ]);

    const result = await new GetPassPricingUseCase(service).execute();

    expect(result).toEqual({
      passes: {
        '24h': { amount: 600, currency: 'usd', display: '$6' },
        '7d': { amount: 1200, currency: 'usd', display: '$12' },
        '120d': { amount: 2900, currency: 'usd', display: '$29' },
      },
    });
  });

  it('renders cents with two decimals when the amount is not a whole dollar', async () => {
    const service = makeService([
      {
        kind: '24h',
        priceId: 'p1',
        amount: 650,
        currency: 'usd',
        source: 'stripe',
      },
    ]);

    const result = await new GetPassPricingUseCase(service).execute();

    expect(result.passes['24h']?.display).toBe('$6.50');
  });

  it('omits a pass whose amount could not be resolved from Stripe', async () => {
    const service = makeService([
      {
        kind: '24h',
        priceId: 'env_price',
        amount: null,
        currency: null,
        source: 'env',
      },
      {
        kind: '7d',
        priceId: 'p2',
        amount: 1200,
        currency: 'usd',
        source: 'stripe',
      },
    ]);

    const result = await new GetPassPricingUseCase(service).execute();

    expect(result.passes['24h']).toBeUndefined();
    expect(result.passes['7d']).toEqual({
      amount: 1200,
      currency: 'usd',
      display: '$12',
    });
  });

  it('formats non-usd currencies with their symbol', async () => {
    const service = makeService([
      {
        kind: '24h',
        priceId: 'p1',
        amount: 500,
        currency: 'eur',
        source: 'stripe',
      },
    ]);

    const result = await new GetPassPricingUseCase(service).execute();

    expect(result.passes['24h']?.display).toBe('€5');
  });
});
