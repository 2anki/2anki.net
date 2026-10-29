import { vi } from 'vitest';
import { Request, Response } from 'express';
import PricingController from './PricingController';

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

describe('PricingController', () => {
  it.each([
    ['a signed-in caller', { owner: 1 }],
    ['a signed-out caller', {}],
  ])('quotes the v2 prices and no deadline to %s', (_who, locals) => {
    const res = makeResponse(locals);

    new PricingController().getPrices(
      {} as Request,
      res as unknown as Response
    );

    expect(res.body).toEqual({
      cohort: 'v2',
      legacy: false,
      monthly: { cents: 799 },
      annual: { cents: 6400 },
      lockInDeadline: null,
    });
  });
});
