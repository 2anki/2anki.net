import express from 'express';
import type { Knex } from 'knex';
import UsersService from '../services/UsersService';
import SubscriptionService, {
  SubscriptionNotOwnedError,
  AnnualPlanNotPausableError,
  SubscriptionTooNewToPauseError,
  InvalidPauseMonthsError,
} from '../services/SubscriptionService';
import { pausedResumesAt } from '../lib/subscriptions/isPaused';
import { track } from '../services/events/track';

class SubscriptionLifecycleController {
  constructor(
    private readonly userService: UsersService,
    private readonly db: Knex
  ) {}

  async cancelSubscription(req: express.Request, res: express.Response) {
    const { owner } = res.locals;
    if (!owner) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const requestedMode =
      req.body?.mode === 'immediate' ? 'immediate' : 'period_end';

    try {
      const user = await this.userService.getUserById(owner);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const processedCount = await SubscriptionService.cancelUserSubscriptions(
        user.email,
        requestedMode
      );

      if (processedCount === 0) {
        return res.status(422).json({
          message:
            "No active subscription found for this account. If you paid with a different email, use the form below to connect it — we'll send a confirmation link to that inbox.",
        });
      }

      const reason =
        typeof req.body?.reason === 'string' && req.body.reason.length > 0
          ? req.body.reason
          : null;
      track('subscription_cancelled', {
        userId: owner,
        props: { reason, cancel_type: requestedMode },
      });

      const message =
        requestedMode === 'immediate'
          ? 'Your subscription has been cancelled. A confirmation email is on its way.'
          : 'Your subscription is scheduled to cancel at the end of the current billing period. A confirmation email is on its way.';

      res.status(200).json({ message });
    } catch (error) {
      console.info('Cancel subscription failed');
      console.error(error);
      return res.status(500).json({ message: 'Failed to cancel subscription' });
    }
  }

  async cancelSubscriptionById(req: express.Request, res: express.Response) {
    const { owner } = res.locals;
    if (!owner) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const id = req.params.id;
    if (id == null || typeof id !== 'string' || id.trim().length === 0) {
      return res.status(400).json({ message: 'A subscription id is required' });
    }

    const requestedMode =
      req.body?.mode === 'period_end' ? 'period_end' : 'immediate';

    try {
      const user = await this.userService.getUserById(owner);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      await SubscriptionService.cancelSubscriptionById(
        user.email,
        id,
        requestedMode
      );

      const reason =
        typeof req.body?.reason === 'string' && req.body.reason.length > 0
          ? req.body.reason
          : null;
      track('subscription_cancelled', {
        userId: owner,
        props: { reason, cancel_type: requestedMode },
      });

      return res.status(200).json({ message: 'This plan has been cancelled.' });
    } catch (error) {
      if (error instanceof SubscriptionNotOwnedError) {
        return res.status(403).json({ message: 'Subscription not found' });
      }
      console.info('Cancel subscription by id failed');
      console.error(error);
      return res.status(500).json({ message: 'Failed to cancel subscription' });
    }
  }

  async submitCancellationFeedback(
    req: express.Request,
    res: express.Response
  ) {
    const { owner } = res.locals;
    if (!owner) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const reason: string | undefined = req.body?.reason;
    if (!reason) {
      return res.status(400).json({ message: 'A reason is required' });
    }
    const comment: string | undefined = req.body?.comment;

    try {
      await this.db('cancellation_feedback').insert({
        owner,
        reason: reason.slice(0, 100),
        comment: comment ? comment.slice(0, 1000) : null,
      });
      res.status(200).json({ message: 'Thanks for the feedback.' });
    } catch (error) {
      console.info('Cancellation feedback failed');
      console.error(error);
      return res.status(500).json({ message: 'Failed to record feedback' });
    }
  }

  async pauseSubscription(req: express.Request, res: express.Response) {
    const { owner } = res.locals;
    if (!owner) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const months = Number(req.body?.months);
    if (![1, 2, 3].includes(months)) {
      return res
        .status(400)
        .json({ message: 'Choose a pause length of 1, 2, or 3 months.' });
    }

    try {
      const user = await this.userService.getUserById(owner);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const result = await SubscriptionService.pauseSubscription(
        user.email,
        months
      );

      return res.status(200).json({
        message: 'Your subscription is paused. Resume any time.',
        resumes_at: result.resumesAt,
      });
    } catch (error) {
      if (error instanceof AnnualPlanNotPausableError) {
        return res
          .status(422)
          .json({ message: 'Annual plans cannot be paused.' });
      }
      if (error instanceof SubscriptionTooNewToPauseError) {
        return res.status(422).json({
          message: 'Pausing is available after 30 days on a plan.',
        });
      }
      if (error instanceof InvalidPauseMonthsError) {
        return res
          .status(400)
          .json({ message: 'Choose a pause length of 1, 2, or 3 months.' });
      }
      if (error instanceof SubscriptionNotOwnedError) {
        return res.status(422).json({
          message: 'No active subscription found for this account.',
        });
      }
      console.info('Pause subscription failed');
      console.error(error);
      return res.status(500).json({ message: 'Failed to pause subscription' });
    }
  }

  async resumeSubscription(req: express.Request, res: express.Response) {
    const { owner } = res.locals;
    if (!owner) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    try {
      const user = await this.userService.getUserById(owner);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      await SubscriptionService.resumeSubscription(user.email);

      track('subscription_pause_resumed', { userId: owner });

      return res
        .status(200)
        .json({ message: 'Your subscription is active again.' });
    } catch (error) {
      if (error instanceof SubscriptionNotOwnedError) {
        return res
          .status(422)
          .json({ message: 'No paused subscription found for this account.' });
      }
      console.info('Resume subscription failed');
      console.error(error);
      return res.status(500).json({ message: 'Failed to resume subscription' });
    }
  }

  async getSubscriptionStatus(req: express.Request, res: express.Response) {
    const { owner } = res.locals;
    if (!owner) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    try {
      const user = await this.userService.getUserById(owner);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      const subs = await SubscriptionService.findRecentStripeSubscriptions(
        user.email
      );

      const subscriptions = subs.map((sub) => {
        const firstItem = sub.items?.data?.[0];
        const price = firstItem?.price;
        return {
          id: sub.id,
          status: sub.status,
          created: sub.created ?? null,
          cancel_at_period_end: sub.cancel_at_period_end === true,
          cancel_at: sub.cancel_at ?? null,
          canceled_at: sub.canceled_at ?? null,
          current_period_end: firstItem?.current_period_end ?? null,
          paused_until: pausedResumesAt(sub),
          cancellation_reason: sub.cancellation_details?.reason ?? null,
          plan: price
            ? {
                amount: price.unit_amount ?? null,
                currency: price.currency ?? null,
                interval: price.recurring?.interval ?? null,
              }
            : null,
        };
      });

      res.status(200).json({ subscriptions });
    } catch (error) {
      console.info('Get subscription status failed');
      console.error(error);
      return res
        .status(500)
        .json({ message: 'Failed to load subscription status' });
    }
  }
}

export default SubscriptionLifecycleController;
