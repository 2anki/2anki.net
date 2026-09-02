import { Request, Response } from 'express';
import PassPricingController from './PassPricingController';
import type {
  GetPassPricingUseCase,
  PassPricingResponse,
} from '../usecases/checkout/GetPassPricingUseCase';

const buildResponse = () => {
  const res = {} as Response;
  res.set = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  return res;
};

const makeUseCase = (response: PassPricingResponse): GetPassPricingUseCase =>
  ({
    execute: jest.fn().mockResolvedValue(response),
  }) as unknown as GetPassPricingUseCase;

describe('PassPricingController', () => {
  it('returns the pass pricing payload as json', async () => {
    const payload: PassPricingResponse = {
      passes: { '24h': { amount: 600, currency: 'usd', display: '$6' } },
    };
    const res = buildResponse();

    await new PassPricingController(makeUseCase(payload)).getPassPricing(
      {} as Request,
      res
    );

    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('sets a short public Cache-Control header', async () => {
    const res = buildResponse();

    await new PassPricingController(makeUseCase({ passes: {} })).getPassPricing(
      {} as Request,
      res
    );

    expect(res.set).toHaveBeenCalledWith(
      'Cache-Control',
      expect.stringContaining('public')
    );
    expect(res.set).toHaveBeenCalledWith(
      'Cache-Control',
      expect.stringContaining('max-age=')
    );
  });
});
