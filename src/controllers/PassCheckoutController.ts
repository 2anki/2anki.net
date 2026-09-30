import { Request, Response } from 'express';
import { CreatePassCheckoutUseCase } from '../usecases/checkout/CreatePassCheckoutUseCase';
import { parsePricingVariant } from '../usecases/checkout/pricingVariant';
import { parseCheckoutSurface } from '../usecases/checkout/checkoutSurface';
import { parseGaClientId } from '../usecases/checkout/gaClientId';
import type { PassKind } from '../data_layer/UserPassRepository';
import type { EventsSink } from '../services/events/EventsSink';

class PassCheckoutController {
  constructor(
    private readonly useCase: CreatePassCheckoutUseCase,
    private readonly passKind: PassKind,
    private readonly eventsSink: Pick<EventsSink, 'record'>
  ) {}

  async createSession(req: Request, res: Response): Promise<void> {
    const userId = res.locals.owner as number | undefined;
    const userEmail = res.locals.email as string | undefined;
    const variant = parsePricingVariant(req.body?.variant);
    const anonId = (req.cookies?.anon_id as string | undefined) ?? undefined;
    const surface = parseCheckoutSurface(req.body?.surface);
    const gaClientId = parseGaClientId(req.cookies?._ga);

    const result = await this.useCase.execute({
      userId,
      userEmail,
      variant,
      anonId,
      surface,
      gaClientId,
    });

    // `plan` carries the pass kind so this joins to checkout_completed, which
    // records the same kind from the Stripe session metadata. Passes are most
    // of what sells, and until this fired they contributed no starts at all,
    // which is why checkout_started read lower than checkout_completed.
    this.eventsSink.record({
      name: 'checkout_started',
      user_id: userId ?? null,
      anonymous_id: userId == null ? (anonId ?? null) : null,
      props: {
        plan: this.passKind,
        ...(surface == null ? {} : { surface }),
        ...(variant == null ? {} : { variant }),
      },
    });

    res.json(result);
  }
}

export default PassCheckoutController;
