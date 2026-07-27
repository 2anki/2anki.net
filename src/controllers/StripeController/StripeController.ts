import express from 'express';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

import { sendIndex } from '../IndexController/sendIndex';
import type AuthenticationService from '../../services/AuthenticationService';
import type UsersService from '../../services/UsersService';
import { extractTokenFromCookies } from './extractTokenFromCookies';
import SubscriptionService from '../../services/SubscriptionService';
import type { PersistStripeSessionUseCase } from '../../usecases/checkout/PersistStripeSessionUseCase';
import type { IUserPassRepository } from '../../data_layer/UserPassRepository';

type StripeClient = Pick<StripeTypes, 'checkout'>;

export class StripeController {
  constructor(
    private readonly authService: AuthenticationService,
    private readonly usersService: UsersService,
    private readonly persistStripeSessionUseCase: PersistStripeSessionUseCase,
    private readonly stripe: StripeClient,
    private readonly userPassRepository: IUserPassRepository
  ) {}

  async getSuccessfulCheckout(req: express.Request, res: express.Response) {
    const cookies = req.get('cookie');
    const token = extractTokenFromCookies(cookies);

    if (!token) {
      return sendIndex(res);
    }

    const loggedInUser = await this.authService.getUserFrom(token);
    const sessionId = req.query.session_id as string;

    if (loggedInUser && sessionId) {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);

      if (this.sessionBelongsToUser(session, loggedInUser)) {
        // Persist subscription before linking — without this, the link write is a
        // no-op when the webhook hasn't fired yet and the subscriptions row doesn't exist.
        await this.persistStripeSessionUseCase.execute(sessionId);

        const email = session.customer_details?.email;

        if (loggedInUser.email !== email && email) {
          await this.usersService.updateSubScriptionEmailUsingPrimaryEmail(
            email.toLowerCase(),
            loggedInUser.email.toLowerCase()
          );
        }
      }
    }

    sendIndex(res);
  }

  private sessionBelongsToUser(
    session: Pick<StripeTypes.Checkout.Session, 'metadata'>,
    loggedInUser: { id: number }
  ): boolean {
    return session.metadata?.user_id === String(loggedInUser.id);
  }

  async checkSubscriptionStatus(req: express.Request, res: express.Response) {
    try {
      const token = extractTokenFromCookies(req.get('cookie'));
      const user = token ? await this.authService.getUserFrom(token) : null;
      if (!user) {
        return res
          .status(401)
          .json({ authenticated: false, hasActiveSubscription: false });
      }

      const activeSubscriptions =
        await SubscriptionService.getUserActiveSubscriptions(user.email);
      let hasActiveSubscription =
        activeSubscriptions.length > 0 || user.patreon === true;

      if (!hasActiveSubscription) {
        const activePass = await this.userPassRepository.findActive(
          user.id,
          new Date()
        );
        hasActiveSubscription = activePass != null;
      }

      if (!hasActiveSubscription) {
        const sessionId = req.query.session_id as string;
        if (sessionId) {
          hasActiveSubscription =
            await this.persistStripeSessionUseCase.execute(sessionId);
        }
      }

      return res.json({
        authenticated: true,
        hasActiveSubscription,
        user: {
          email: user.email,
          name: user.name,
          patreon: user.patreon,
        },
      });
    } catch (error) {
      console.error('Error checking subscription status:', error);
      return res.status(500).json({
        authenticated: false,
        hasActiveSubscription: false,
        error: 'Internal server error',
      });
    }
  }

  async cancelUserSubscriptions(userEmail: string): Promise<void> {
    await SubscriptionService.cancelUserSubscriptions(userEmail);
  }
}
