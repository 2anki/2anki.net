import express from 'express';
import type AuthenticationService from '../../services/AuthenticationService';
import { extractTokenFromCookies } from './extractTokenFromCookies';
import SubscriptionService from '../../services/SubscriptionService';
import type { PersistStripeSessionUseCase } from '../../usecases/checkout/PersistStripeSessionUseCase';
import type { IUserPassRepository } from '../../data_layer/UserPassRepository';

export class StripeController {
  constructor(
    private readonly authService: AuthenticationService,
    private readonly persistStripeSessionUseCase: PersistStripeSessionUseCase,
    private readonly userPassRepository: IUserPassRepository
  ) {}

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
