import { Request, Response } from 'express';
import { CreateCreditPackCheckoutUseCase } from '../usecases/checkout/CreateCreditPackCheckoutUseCase';
import { parseCreditPackSource } from '../usecases/checkout/creditPack';
import { readGaMeasurement } from '../usecases/checkout/gaClientId';
import { readAdClickCookie } from '../lib/attribution/adClick';

class CreditPackCheckoutController {
  constructor(private readonly useCase: CreateCreditPackCheckoutUseCase) {}

  async createSession(req: Request, res: Response): Promise<void> {
    const userId = res.locals.owner as number | undefined;
    if (userId == null) {
      res.status(401).json({ message: 'Sign in to buy credits.' });
      return;
    }
    const userEmail = res.locals.email as string | undefined;
    const stripeCustomerId = res.locals.stripeCustomerId as string | undefined;
    const source = parseCreditPackSource(req.body?.source);
    const { gaClientId, gaSessionId } = readGaMeasurement(req);
    const adClick = readAdClickCookie(req);

    const result = await this.useCase.execute({
      userId,
      userEmail,
      source,
      gaClientId,
      gaSessionId,
      adClick,
      stripeCustomerId,
    });
    res.json(result);
  }
}

export default CreditPackCheckoutController;
