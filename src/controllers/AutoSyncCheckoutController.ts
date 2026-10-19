import { Request, Response } from 'express';
import { AutoSyncCheckoutUseCase } from '../usecases/checkout/AutoSyncCheckoutUseCase';
import { parsePricingVariant } from '../usecases/checkout/pricingVariant';
import { parseCheckoutSurface } from '../usecases/checkout/checkoutSurface';
import { readGaMeasurement } from '../usecases/checkout/gaClientId';
import { readCheckoutAttribution } from '../lib/attribution/adClick';

class AutoSyncCheckoutController {
  constructor(private readonly useCase: AutoSyncCheckoutUseCase) {}

  async createSession(req: Request, res: Response): Promise<void> {
    const userId = res.locals.owner as number;
    const userEmail = res.locals.email as string;
    const stripeCustomerId = res.locals.stripeCustomerId as string | undefined;
    const variant = parsePricingVariant(req.body?.variant);
    const anonId = (req.cookies?.anon_id as string | undefined) ?? undefined;
    const surface = parseCheckoutSurface(req.body?.surface);
    const { gaClientId, gaSessionId } = readGaMeasurement(req);
    const adClick = readCheckoutAttribution(req);

    const result = await this.useCase.execute({
      userId,
      userEmail,
      stripeCustomerId,
      variant,
      anonId,
      surface,
      gaClientId,
      gaSessionId,
      adClick,
    });
    res.json(result);
  }
}

export default AutoSyncCheckoutController;
