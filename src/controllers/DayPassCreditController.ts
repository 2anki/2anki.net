import { Request, Response } from 'express';
import { readGaMeasurement } from '../usecases/checkout/gaClientId';
import { readCheckoutAttribution } from '../lib/attribution/adClick';
import { checkoutRequestProps } from '../lib/analytics/checkoutRequestProps';
import { trackingAllowedFor } from '../lib/http/consentRegion';
import { DAY_PASS_CREDIT_SURFACE } from '../usecases/checkout/dayPassCredit';
import type {
  CreateDayPassCreditCheckoutUseCase,
  DayPassCreditCheckoutRefusal,
} from '../usecases/checkout/CreateDayPassCreditCheckoutUseCase';
import type { GetDayPassCreditOfferUseCase } from '../usecases/checkout/GetDayPassCreditOfferUseCase';
import type { EventsSink } from '../services/events/EventsSink';

const CONFLICTS: Record<
  Exclude<DayPassCreditCheckoutRefusal, 'price_unavailable'>,
  { code: string; message: string }
> = {
  plan_held: {
    code: 'day_pass_credit_unavailable',
    message: 'This offer is not available on your account.',
  },
  no_recent_day_pass: {
    code: 'day_pass_credit_unavailable',
    message: 'This offer is not available on your account.',
  },
  credit_used: {
    code: 'day_pass_credit_used',
    message: 'Your Day Pass credit has already been used.',
  },
  checkout_open: {
    code: 'day_pass_credit_checkout_open',
    message: 'A checkout for this offer is already open. Try again.',
  },
};

class DayPassCreditController {
  constructor(
    private readonly getOfferUseCase: GetDayPassCreditOfferUseCase,
    private readonly checkoutUseCase: CreateDayPassCreditCheckoutUseCase,
    private readonly eventsSink: Pick<EventsSink, 'record'>
  ) {}

  async getOffer(_req: Request, res: Response): Promise<void> {
    const userId = Number(res.locals.owner);
    res.json(await this.getOfferUseCase.execute(userId));
  }

  async createSession(req: Request, res: Response): Promise<void> {
    const userId = Number(res.locals.owner);
    const anonIdTrackingAllowed = trackingAllowedFor(req);
    const { gaClientId, gaSessionId } = readGaMeasurement(req);

    const result = await this.checkoutUseCase.execute({
      userId,
      userEmail: res.locals.email as string | undefined,
      stripeCustomerId: res.locals.stripeCustomerId as string | undefined,
      anonId: (req.cookies?.anon_id as string | undefined) ?? undefined,
      anonIdTrackingAllowed,
      gaClientId,
      gaSessionId,
      adClick: readCheckoutAttribution(req),
    });

    if (result.status === 'session') {
      this.eventsSink.record({
        name: 'checkout_started',
        user_id: userId,
        anonymous_id: null,
        props: {
          plan: '120d',
          surface: DAY_PASS_CREDIT_SURFACE,
          ...checkoutRequestProps(req),
        },
      });
      res.json({ url: result.url });
      return;
    }

    console.info('checkout.day_pass_credit.refused', {
      user_id: userId,
      reason: result.reason,
    });
    if (result.reason === 'price_unavailable') {
      res
        .status(503)
        .json({ message: 'The Semester Pass is not available right now.' });
      return;
    }
    res.status(409).json(CONFLICTS[result.reason]);
  }
}

export default DayPassCreditController;
