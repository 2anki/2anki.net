import { vi } from 'vitest';
import { Request, Response } from 'express';
import PricingController, {
  PricingControllerContext,
} from './PricingController';

const makeResponse = (locals: Record<string, unknown> = {}) => {
  const res = {
    body: undefined as unknown,
    locals,
    json: vi.fn(),
  };
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
};

const makeContext = (
  overrides: Partial<PricingControllerContext> = {}
): PricingControllerContext => ({
  pricingV2On: true,
  getUserCreatedAt: vi.fn().mockResolvedValue(null),
  ...overrides,
});

describe('PricingController', () => {
  it('returns v2 prices and no deadline for a post-cutover user', async () => {
    const context = makeContext({
      getUserCreatedAt: vi
        .fn()
        .mockResolvedValue(new Date('2026-06-16T00:00:00Z')),
    });
    const controller = new PricingController(context);
    const res = makeResponse({ owner: 1 });

    await controller.getPrices({} as Request, res as unknown as Response);

    expect(res.body).toEqual({
      cohort: 'v2',
      legacy: false,
      monthly: { cents: 799 },
      annual: { cents: 6400 },
      lockInDeadline: null,
    });
  });

  it('returns v2 prices for a logged-out caller when flag on', async () => {
    const context = makeContext();
    const controller = new PricingController(context);
    const res = makeResponse({});

    await controller.getPrices({} as Request, res as unknown as Response);

    expect(res.body).toMatchObject({
      cohort: 'v2',
      legacy: false,
      monthly: { cents: 799 },
      annual: { cents: 6400 },
      lockInDeadline: null,
    });
    expect(context.getUserCreatedAt).not.toHaveBeenCalled();
  });

  it('returns legacy prices and no deadline when the flag is off', async () => {
    const context = makeContext({ pricingV2On: false });
    const controller = new PricingController(context);
    const res = makeResponse({ owner: 1 });

    await controller.getPrices({} as Request, res as unknown as Response);

    expect(res.body).toEqual({
      cohort: 'legacy',
      legacy: true,
      monthly: { cents: 600 },
      annual: { cents: 6000 },
      lockInDeadline: null,
    });
  });
});
