import { Request, Response } from 'express';
import type { GetPassPricingUseCase } from '../usecases/checkout/GetPassPricingUseCase';

const CACHE_CONTROL = 'public, max-age=300';

class PassPricingController {
  constructor(private readonly useCase: GetPassPricingUseCase) {}

  async getPassPricing(_req: Request, res: Response): Promise<void> {
    const pricing = await this.useCase.execute();
    res.set('Cache-Control', CACHE_CONTROL);
    res.json(pricing);
  }
}

export default PassPricingController;
