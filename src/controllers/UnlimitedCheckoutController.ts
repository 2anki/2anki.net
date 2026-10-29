import { Request, Response } from 'express';
import {
  UnlimitedCheckoutUseCase,
  UnlimitedInterval,
} from '../usecases/checkout/UnlimitedCheckoutUseCase';
import { parsePricingVariant } from '../usecases/checkout/pricingVariant';
import { parseCheckoutSurface } from '../usecases/checkout/checkoutSurface';
import { readGaMeasurement } from '../usecases/checkout/gaClientId';
import { readCheckoutAttribution } from '../lib/attribution/adClick';
import { PricingResolutionError } from '../usecases/checkout/PricingResolutionError';
import { LapsedSubscriptionError } from '../usecases/checkout/LapsedSubscriptions';
import { isCurrencyConflictError } from '../usecases/checkout/createCheckoutSession';
import type { EventsSink } from '../services/events/EventsSink';

const VALID_INTERVALS: ReadonlySet<string> = new Set(['month', 'year']);

class UnlimitedCheckoutController {
  constructor(
    private readonly useCase: UnlimitedCheckoutUseCase,
    private readonly eventsSink: Pick<EventsSink, 'record'>
  ) {}

  async createSession(req: Request, res: Response): Promise<void> {
    const interval = req.body?.interval;
    if (typeof interval !== 'string' || !VALID_INTERVALS.has(interval)) {
      res.status(400).json({ message: 'interval must be "month" or "year"' });
      return;
    }

    const userId = res.locals.owner as number;
    const userEmail = res.locals.email as string;
    const stripeCustomerId = res.locals.stripeCustomerId as string | undefined;
    const anonId = (req.cookies?.anon_id as string | undefined) ?? undefined;
    const { gaClientId, gaSessionId } = readGaMeasurement(req);
    const adClick = readCheckoutAttribution(req);
    const surface = parseCheckoutSurface(req.body?.surface);

    let result;
    try {
      result = await this.useCase.execute({
        userId,
        userEmail,
        stripeCustomerId,
        interval: interval as UnlimitedInterval,
        variant: parsePricingVariant(req.body?.variant),
        anonId,
        surface,
        gaClientId,
        gaSessionId,
        adClick,
        replaceLapsed: req.body?.replaceLapsed === true,
      });
    } catch (error) {
      if (error instanceof PricingResolutionError) {
        res.status(503).json({
          message:
            'Checkout is temporarily unavailable. Try again in a moment.',
        });
        return;
      }
      if (error instanceof LapsedSubscriptionError) {
        const { amount, currency, interval, payUrl } = error.plan;
        res.status(409).json({
          code: 'lapsed_subscription',
          message: "Your current plan's last payment didn't go through.",
          expiresAt: null,
          lapsedPlan: { amount, currency, interval, payUrl },
        });
        return;
      }
      if (isCurrencyConflictError(error)) {
        console.warn('unlimited.checkout.currency_conflict', {
          user_id: userId,
        });
        res.status(409).json({
          code: 'currency_conflict',
          message:
            'Your earlier plan is billed in another currency, so this one cannot start yet.',
          expiresAt: null,
        });
        return;
      }
      throw error;
    }

    // 'subscription' rather than 'unlimited' so this joins to
    // checkout_completed, which records the mode from the Stripe session. The
    // two used to disagree, so subscription starts and completions could not be
    // matched at all.
    this.eventsSink.record({
      name: 'checkout_started',
      user_id: userId,
      props: {
        plan: 'subscription',
        interval,
        cohort: result.cohort,
        ...(surface == null ? {} : { surface }),
      },
    });

    res.json({ url: result.url });
  }
}

export default UnlimitedCheckoutController;
