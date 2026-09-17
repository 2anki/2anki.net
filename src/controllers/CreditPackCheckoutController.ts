import { Request, Response } from 'express';
import { CreateCreditPackCheckoutUseCase } from '../usecases/checkout/CreateCreditPackCheckoutUseCase';
import { parseCreditPackSource } from '../usecases/checkout/creditPack';
import { parseGaClientId } from '../usecases/checkout/gaClientId';
import type UsersRepository from '../data_layer/UsersRepository';

class CreditPackCheckoutController {
  constructor(
    private readonly useCase: CreateCreditPackCheckoutUseCase,
    private readonly usersRepository: Pick<
      UsersRepository,
      'getStripeCustomerId'
    >
  ) {}

  async createSession(req: Request, res: Response): Promise<void> {
    const userId = res.locals.owner as number | undefined;
    if (userId == null) {
      res.status(401).json({ message: 'Sign in to buy credits.' });
      return;
    }
    const userEmail = res.locals.email as string | undefined;
    const source = parseCreditPackSource(req.body?.source);
    const gaClientId = parseGaClientId(req.cookies?._ga);
    const stripeCustomerId =
      await this.usersRepository.getStripeCustomerId(userId);

    const result = await this.useCase.execute({
      userId,
      userEmail,
      source,
      gaClientId,
      stripeCustomerId,
    });
    res.json(result);
  }
}

export default CreditPackCheckoutController;
