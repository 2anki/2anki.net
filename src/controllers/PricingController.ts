import { Request, Response } from 'express';
import { PRICING_COHORT, V2_PRICE_CENTS } from '../usecases/checkout/pricingV2';

class PricingController {
  getPrices(_req: Request, res: Response): void {
    res.json({
      cohort: PRICING_COHORT,
      legacy: false,
      monthly: { cents: V2_PRICE_CENTS.monthly },
      annual: { cents: V2_PRICE_CENTS.annual },
      lockInDeadline: null,
    });
  }
}

export default PricingController;
