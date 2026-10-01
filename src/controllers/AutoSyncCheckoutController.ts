import { Request, Response } from 'express';
import { AutoSyncCheckoutUseCase } from '../usecases/checkout/AutoSyncCheckoutUseCase';
import { parsePricingVariant } from '../usecases/checkout/pricingVariant';
import { parseCheckoutSurface } from '../usecases/checkout/checkoutSurface';
import { parseGaClientId } from '../usecases/checkout/gaClientId';

class AutoSyncCheckoutController {
  constructor(private readonly useCase: AutoSyncCheckoutUseCase) {}

  async createSession(req: Request, res: Response): Promise<void> {
    const userId = res.locals.owner as number;
    const userEmail = res.locals.email as string;
    const stripeCustomerId = res.locals.stripeCustomerId as string | undefined;
    const variant = parsePricingVariant(req.body?.variant);
    const anonId = (req.cookies?.anon_id as string | undefined) ?? undefined;
    const surface = parseCheckoutSurface(req.body?.surface);
    const gaClientId = parseGaClientId(req.cookies?._ga);

    const result = await this.useCase.execute({
      userId,
      userEmail,
      stripeCustomerId,
      variant,
      anonId,
      surface,
      gaClientId,
    });
    res.json(result);
  }
}

export default AutoSyncCheckoutController;
