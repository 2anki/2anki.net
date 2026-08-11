import crypto from 'node:crypto';
import express from 'express';
import { InMemoryRateLimiter } from '../lib/rateLimit/InMemoryRateLimiter';
import { hashIp, resolveClientIp } from '../lib/rateLimit/ipHelpers';

// The reset-redemption endpoint is unauthenticated by nature, so throttle
// per-IP attempts to keep it from being usable for token guessing.
const newPasswordRateLimiter = new InMemoryRateLimiter({
  windowMs: 15 * 60 * 1000,
  perKeyMax: 10,
  globalMax: 500,
});

import AuthenticationService, {
  UserWithOwner,
} from '../services/AuthenticationService';
import UsersService from '../services/UsersService';
import { getRedirect } from './helpers/getRedirect';
import { parseSignupOrigin } from './helpers/parseSignupOrigin';
import {
  parseFirstTouch,
  FirstTouchAttribution,
} from './helpers/parseFirstTouch';
import { sessionCookieOptions } from '../shared/session';

import { sendIndex } from './IndexController/sendIndex';
import { getRandomUUID } from '../shared/helpers/getRandomUUID';
import SubscriptionService, {
  SubscriptionNotOwnedError,
  AnnualPlanNotPausableError,
  SubscriptionTooNewToPauseError,
  InvalidPauseMonthsError,
} from '../services/SubscriptionService';
import { pausedResumesAt } from '../lib/subscriptions/isPaused';
import { OPS_OWNER_EMAIL } from '../routes/middleware/RequireOpsAccess';
import {
  MagicLinkRateLimitError,
  MagicLinkSuppressedError,
} from '../services/UsersService';
import { MONTHLY_CARD_LIMIT } from '../usecases/users/CheckMonthlyCardLimitUseCase';
import UsersRepository from '../data_layer/UsersRepository';
import OauthIdentitiesRepository from '../data_layer/OauthIdentitiesRepository';
import { UsersId } from '../data_layer/public/Users';
import { isPaying } from '../lib/isPaying';
import NotionRepository from '../data_layer/NotionRespository';
import hashToken from '../lib/misc/hashToken';
import { extractCountryFromRequest } from '../lib/http/extractCountryFromRequest';
import { RecordUserVisibleErrorUseCase } from '../usecases/observability/RecordUserVisibleErrorUseCase';
import { track } from '../services/events/track';
import { mapEntitlement } from './helpers/mapEntitlement';
import { hasAnkifyAccess } from '../lib/ankify/access';

function readFirstTouchCookie(req: express.Request): FirstTouchAttribution {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  return parseFirstTouch(cookies?.first_touch);
}

function buildSignupProps(
  signupOrigin: string | null,
  signupReferrer: string | null
): Record<string, string> {
  const props: Record<string, string> = {};
  if (signupOrigin != null) {
    props.signup_origin = signupOrigin;
  }
  if (signupReferrer != null) {
    props.signup_referrer = signupReferrer;
  }
  return props;
}

class UsersController {
  constructor(
    private readonly userService: UsersService,
    private readonly authService: AuthenticationService,
    private readonly db: ReturnType<typeof import('../data_layer').getDatabase>,
    private readonly recordError: RecordUserVisibleErrorUseCase | null = null
  ) {}

  async newPassword(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const resetToken = req.body.reset_token;
    const { password } = req.body;

    if (this.authService.isNewPasswordValid(resetToken, password)) {
      return res.status(400).send({ message: 'invalid' });
    }

    if (!newPasswordRateLimiter.check(hashIp(resolveClientIp(req)))) {
      return res.status(429).send({ message: 'invalid' });
    }

    try {
      // Resolve the owner before redeeming, because redeeming clears the
      // token. Sessions are revoked only after the redeem succeeds — doing it
      // first would let a stale token log the owner out on every attempt even
      // though the password change is refused.
      const owner = await this.userService.getUserByLiveResetToken(resetToken);
      const updated = await this.userService.updatePassword(
        this.authService.getHashPassword(password),
        resetToken
      );
      // No row matched: the token is unknown, already used, or past its
      // window. Same response either way so the endpoint cannot be used to
      // probe which tokens exist.
      if (updated === 0 || owner?.id == null) {
        return res.status(400).send({ message: 'invalid' });
      }
      await this.authService.logOutEverywhere(owner.id);
      res.status(200).send({ message: 'ok' });
    } catch (error) {
      console.info('Update password failed');
      console.error(error);
      next(new Error('Failed to create new password.'));
    }
  }

  async forgotPassword(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const { email } = req.body;

    if (!email) {
      console.debug('no email provided');
      return res.status(400).json({ message: 'Email is required' });
    }

    try {
      await this.userService.sendResetEmail(email, this.authService);
      return res.status(200).json({ message: 'ok' });
    } catch (error) {
      console.info('Send reset email failed');
      console.error(error);
      next(error);
    }
  }

  async logOut(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const { token } = req.cookies;

    if (!token) {
      res.status(400).json({ error: 'Token cookie missing' });
      return;
    }

    try {
      await this.authService.logOut(token);
      res.clearCookie('token');
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  }

  async logOutEverywhere(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const { owner } = res.locals;

    if (owner == null) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    try {
      await this.authService.logOutEverywhere(owner);
      res.clearCookie('token');
      return res.status(200).json({ message: 'ok' });
    } catch (error) {
      return next(error);
    }
  }

  async login(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    console.debug('Login attempt');
    const { email, password } = req.body;
    if (!this.authService.isValidLogin(email, password)) {
      return res.status(400).json({
        message: 'Invalid user data. Required  email and password!',
      });
    }

    try {
      const user = await this.userService.getUserFrom(email);
      if (!user) {
        return res.status(401).json({ message: 'Wrong email or password.' });
      }

      const isMatch = this.authService.comparePassword(password, user.password);
      if (!isMatch) {
        if (
          typeof user.password === 'string' &&
          !user.password.startsWith('$2b$')
        ) {
          return res
            .status(401)
            .json({ message: 'Wrong email or password.', hint: 'google' });
        }
        return res.status(401).json({ message: 'Wrong email or password.' });
      }

      const token = await this.authService.newJWTToken(user.id);
      if (token) {
        await this.authService.persistToken(token, user.id.toString());
        await this.userService.updateLastLoginAt(user.id.toString());
        res.cookie('token', token, sessionCookieOptions());
        const redirect = await this.landingForUser(req, user.id);
        res.status(200).json({ token, redirect });
      }
    } catch (error) {
      console.info('Login failed');
      console.error(error);
      next(
        new Error('Failed to login, please try again or register your account.')
      );
    }
  }

  async register(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    if (!req.body || !this.isValidUser(req.body.password, req.body.email)) {
      res.status(400).json({
        message: 'Invalid user data. Required email and password!',
      });
      return;
    }

    const doesUserExist = await this.userService.getUserFrom(req.body.email);
    if (doesUserExist) {
      console.debug('User already exists');
      return res.status(400).json({
        message:
          'An account with this email already exists. Try logging in instead.',
      });
    }

    const password = this.authService.getHashPassword(req.body.password);
    const { name, email } = req.body;
    const firstTouch = readFirstTouchCookie(req);
    const signupOrigin =
      firstTouch.signupOrigin ?? parseSignupOrigin(req.body.source);
    try {
      await this.userService.register(
        name ?? '',
        password,
        email,
        signupOrigin
      );
      const newUser = await this.userService.getUserFrom(email);
      if (newUser) {
        const cookies = req.cookies as Record<string, unknown> | undefined;
        const anonId = cookies?.anon_id;
        track('account_created', {
          userId: Number(newUser.id),
          anonymousId:
            typeof anonId === 'string' && anonId.length > 0 ? anonId : null,
          props: buildSignupProps(signupOrigin, firstTouch.signupReferrer),
        });
        try {
          const country = extractCountryFromRequest(req);
          if (country != null) {
            await new UsersRepository(this.db).setSignupCountryIfMissing(
              newUser.id,
              country
            );
          }
        } catch {
          // country capture is best-effort
        }
        const token = await this.authService.newJWTToken(newUser.id);
        if (token) {
          await this.authService.persistToken(token, newUser.id.toString());
          await this.userService.updateLastLoginAt(newUser.id.toString());
          res.cookie('token', token, sessionCookieOptions());
          return res.status(200).json({ token });
        }
      }
      res.status(200).json({ message: 'ok' });
    } catch (error) {
      console.info('Register failed');
      console.error(error);
      return next(error);
    }
  }

  async resetPassword(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    try {
      const token = req.params.id;
      const isValid = await this.authService.isValidToken(token);
      if (isValid) {
        return sendIndex(res);
      }
      return res.redirect('/login');
    } catch (error) {
      console.info('Reset password failed');
      console.error(error);
      next(error);
    }
  }

  private async resolveSignupCountry(
    user: UserWithOwner | null,
    req: express.Request
  ): Promise<string | null> {
    if (user?.id == null) return null;
    const repo = new UsersRepository(this.db);
    try {
      const existing = await repo.getSignupCountry(user.id);
      if (existing != null) return existing;
    } catch {
      return null;
    }
    const fromHeader = extractCountryFromRequest(req);
    if (fromHeader == null) return null;
    try {
      await repo.setSignupCountryIfMissing(user.id, fromHeader);
    } catch {
      // best-effort write; ignore so getLocals stays robust in tests
    }
    return fromHeader;
  }

  async getLocals(req: express.Request, res: express.Response) {
    const { locals } = res;
    const user: UserWithOwner | null = await this.authService.getUserFrom(
      req.cookies.token
    );
    const linkedEmail = user?.owner
      ? await this.userService.getSubscriptionLinkedEmail(user.owner.toString())
      : null;
    const signupCountry = await this.resolveSignupCountry(user, req);

    const featureFlags = {
      kiUI: false,
      ops: user?.email?.toLowerCase() === OPS_OWNER_EMAIL,
    };

    // featureFlags.kiUI = user?.patreon || res.locals.subscriber;

    const autoSyncProductId = process.env.AUTO_SYNC_PRODUCT_ID ?? '';
    const maxSubscribers =
      Number.parseInt(process.env.HOSTED_ANKI_MAX_SUBSCRIBERS ?? '', 10) || 50;
    const autoSyncActiveCount =
      autoSyncProductId === ''
        ? 0
        : await SubscriptionService.countActiveByProductId(autoSyncProductId);
    const autoSyncCapReached = autoSyncActiveCount >= maxSubscribers;

    const userSubs = user?.email
      ? await SubscriptionService.getUserActiveSubscriptions(user.email)
      : [];
    const autoSyncActive = hasAnkifyAccess(user, userSubs, autoSyncProductId);

    let freePrintAvailable: boolean | null = null;
    if (user?.owner != null) {
      const { prints_used } = await new UsersRepository(this.db).getPrintUsage(
        user.owner
      );
      freePrintAvailable = prints_used < 1;
    }

    const response = {
      user: {
        id: user?.id,
        name: user?.name,
        patreon: user?.patreon,
        email: user?.email,
        email_verified: user?.email_verified ?? false,
        ankify_welcome_seen: user?.ankify_welcome_seen ?? false,
        signup_country: signupCountry,
        chat_consent_at: user?.chat_consent_at ?? null,
        created_at: user?.created_at ?? null,
        onboarded_at: user?.onboarded_at ?? null,
      },
      locals,
      entitlement: mapEntitlement(locals),
      linked_email: linkedEmail,
      features: featureFlags,
      hostedAnkiRequested: user?.hosted_anki_requested_at != null,
      autoSyncCapReached,
      autoSyncActive,
      freePrintAvailable,
    };

    return res.json(response);
  }

  async markAnkifyWelcomeSeen(_req: express.Request, res: express.Response) {
    const { owner } = res.locals;
    if (owner == null) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    await this.userService.markAnkifyWelcomeSeen(owner);
    return res.json({ ok: true });
  }

  async linkEmail(req: express.Request, res: express.Response) {
    console.info('linkEmail');
    const { email } = req.body;
    const { owner } = res.locals;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    if (!owner) {
      return res.status(400).json({});
    }

    try {
      const emailExists =
        await this.userService.checkSubscriptionEmailExists(email);
      if (!emailExists) {
        console.warn('Linking attempted with non-existent email');
        return res.status(400).json({ message: 'Failed to link email.' });
      }

      await this.userService.updateSubscriptionLinkedEmail(owner, email);
      return res.status(200).json({});
    } catch (error) {
      console.info('Link email failed');
      console.error(error);
      return res.status(500).json({ message: 'Failed to link email' });
    }
  }

  async requestHostedAnkiAccess(req: express.Request, res: express.Response) {
    const { owner } = res.locals;
    if (owner == null) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    try {
      const result = await this.userService.requestHostedAnkiAccess(owner);
      if (!result.ok) {
        return res.status(500).json({ message: 'Could not send request' });
      }
      return res
        .status(200)
        .json({ ok: true, alreadyRequested: result.alreadyRequested ?? false });
    } catch (error) {
      console.error('Auto Sync access request failed', error);
      return res.status(500).json({ message: 'Could not send request' });
    }
  }

  async deleteAccount(req: express.Request, res: express.Response) {
    const { owner } = res.locals;
    if (!owner) {
      return res.status(400).json({});
    }

    try {
      const user = await this.userService.getUserById(owner);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // A failed Stripe cancel must block the deletion: with the account row
      // gone there is no user left to retry from, the reconcile sweep is off
      // in production, and the subscription would keep billing a ghost.
      try {
        await SubscriptionService.cancelUserSubscriptions(
          user.email,
          'immediate',
          true
        );
      } catch (cancelError) {
        console.error(
          'Subscription cancellation failed during account deletion:',
          cancelError
        );
        return res.status(502).json({
          message:
            "We couldn't cancel your subscription, so your account was not deleted. Try again in a minute.",
        });
      }

      await this.#revokeAppleTokenForOwner(user.id);

      await this.userService.deleteUser(owner);
      res.status(200).json({});
    } catch (error) {
      console.info('Delete account failed');
      console.error(error);
      return res.status(500).json({ message: 'Failed to delete account' });
    }
  }

  async #revokeAppleTokenForOwner(userId: UsersId) {
    try {
      const oauthIdentitiesRepo = new OauthIdentitiesRepository(this.db);
      const refreshToken =
        await oauthIdentitiesRepo.findRefreshTokenByUserAndProvider(
          userId,
          'apple'
        );
      if (refreshToken == null) {
        return;
      }
      await this.authService.revokeAppleToken(refreshToken);
    } catch (revokeError) {
      console.error(
        'Apple token revocation failed during account deletion:',
        revokeError
      );
    }
  }

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
            'No active subscription found for this account. If you paid with a different email, enter it in the field below and try again.',
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

  async getCardUsage(_req: express.Request, res: express.Response) {
    const { owner } = res.locals;
    if (!owner) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const unlimited = isPaying(res.locals);
    if (unlimited) {
      return res.status(200).json({
        cards_used: 0,
        cards_limit: MONTHLY_CARD_LIMIT,
        unlimited: true,
      });
    }

    try {
      const usersRepository = new UsersRepository(this.db);
      const { cards_used } = await usersRepository.getCardUsage(owner);
      return res.status(200).json({
        cards_used,
        cards_limit: MONTHLY_CARD_LIMIT,
        unlimited: false,
      });
    } catch (error) {
      console.info('Get card usage failed');
      console.error(error);
      return res.status(500).json({ message: 'Failed to load card usage' });
    }
  }

  async checkUser(req: express.Request, res: express.Response) {
    const user = await this.authService.getUserFrom(req.cookies.token);
    if (!user) {
      sendIndex(res);
    } else {
      res.redirect(getRedirect(req));
    }
  }

  patreon(req: express.Request, res: express.Response) {
    return res.redirect('https://www.patreon.com/alemayhu');
  }

  public isValidUser(password: string, email: string) {
    if (!password || !email) {
      return false;
    }
    return true;
  }

  async loginWithGoogle(req: express.Request, res: express.Response) {
    console.debug('Login with google');
    const { code } = req.query;
    if (!code) {
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_google',
        code: 'oauth_cancelled',
      });
      return res.redirect('/login?error=google_signin_failed');
    }

    const loginRequest = await this.authService.loginWithGoogle(code as string);

    if (!loginRequest.ok) {
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_google',
        code: 'oauth_token_exchange_failed',
        context: {
          reason: loginRequest.reason,
          message: loginRequest.message,
          userAgent: req.headers?.['user-agent'] ?? null,
        },
      });
      return res.redirect('/login?error=google_signin_failed');
    }

    const { email, name } = loginRequest;
    if (email == null) {
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_google',
        code: 'oauth_token_exchange_failed',
        context: { reason: 'missing_email_claim' },
      });
      return res.redirect('/login?error=google_signin_failed');
    }

    let user = await this.userService.getUserFrom(email);
    const isNewUser = !user;
    if (!user) {
      const hashedPassword = this.authService.getHashPassword(getRandomUUID());
      await this.userService.register(
        name ?? email,
        hashedPassword,
        email,
        readFirstTouchCookie(req).signupOrigin ?? 'google'
      );
      user = await this.userService.getUserFrom(email);
    }
    if (isNewUser && user) {
      try {
        const country = extractCountryFromRequest(req);
        if (country != null) {
          await new UsersRepository(this.db).setSignupCountryIfMissing(
            user.id,
            country
          );
        }
      } catch {
        // country capture is best-effort
      }
    }

    if (!user) {
      console.info('Failed to create user');
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_google',
        code: 'oauth_user_creation_failed',
      });
      return res
        .status(400)
        .send('Unknown error. Please try again or register a new account.');
    }

    await this.userService.markEmailVerified(user.id.toString());

    const token = await this.authService.newJWTToken(user.id);
    if (!token) {
      console.info('Failed to create token');
      return res
        .status(400)
        .send('Unknown error. Please try again or register a new account.');
    }
    await this.authService.persistToken(token, user.id.toString());
    await this.userService.updateLastLoginAt(user.id.toString());
    res.cookie('token', token, sessionCookieOptions());
    res.status(200).redirect(await this.landingForUser(req, user.id));
  }

  async loginWithMicrosoft(req: express.Request, res: express.Response) {
    console.debug('Login with microsoft');
    const { code } = req.query;
    if (!code) {
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_microsoft',
        code: 'oauth_cancelled',
      });
      return res.redirect('/login?error=microsoft_signin_failed');
    }

    const loginRequest = await this.authService.loginWithMicrosoft(
      code as string
    );
    if (!loginRequest) {
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_microsoft',
        code: 'oauth_token_exchange_failed',
      });
      return res.redirect('/login?error=microsoft_signin_failed');
    }

    const { subject, email, name, emailVerified } = loginRequest;
    const oauthIdentitiesRepo = new OauthIdentitiesRepository(this.db);
    const existingIdentity = await oauthIdentitiesRepo.findByProviderAndSubject(
      'microsoft',
      subject
    );

    let user = existingIdentity
      ? await this.userService.getUserById(existingIdentity.user_id.toString())
      : null;
    let isNewUser = false;

    if (!user) {
      if (!email) {
        await this.recordError?.execute({
          userId: null,
          surface: 'oauth_microsoft',
          code: 'oauth_email_missing',
        });
        return res.redirect('/login?error=microsoft_signin_failed');
      }
      if (!emailVerified) {
        await this.recordError?.execute({
          userId: null,
          surface: 'oauth_microsoft',
          code: 'oauth_email_not_verified',
        });
        return res.redirect('/login?error=microsoft_signin_failed');
      }
      const existingByEmail = await this.userService.getUserFrom(email);
      if (existingByEmail) {
        await oauthIdentitiesRepo.link(
          'microsoft',
          subject,
          existingByEmail.id
        );
        user = existingByEmail;
      } else {
        const hashedPassword =
          this.authService.getHashPassword(getRandomUUID());
        await this.userService.register(
          name ?? email,
          hashedPassword,
          email,
          readFirstTouchCookie(req).signupOrigin ?? 'microsoft'
        );
        user = await this.userService.getUserFrom(email);
        isNewUser = true;
        if (user) {
          await oauthIdentitiesRepo.link('microsoft', subject, user.id);
        }
      }
    }

    if (!user) {
      console.info('Failed to create user');
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_microsoft',
        code: 'oauth_user_creation_failed',
      });
      return res
        .status(400)
        .send('Unknown error. Please try again or register a new account.');
    }

    if (isNewUser) {
      try {
        const country = extractCountryFromRequest(req);
        if (country != null) {
          await new UsersRepository(this.db).setSignupCountryIfMissing(
            user.id,
            country
          );
        }
      } catch {
        // country capture is best-effort
      }
    }

    await this.userService.markEmailVerified(user.id.toString());

    const token = await this.authService.newJWTToken(user.id);
    if (!token) {
      console.info('Failed to create token');
      return res
        .status(400)
        .send('Unknown error. Please try again or register a new account.');
    }
    await this.authService.persistToken(token, user.id.toString());
    await this.userService.updateLastLoginAt(user.id.toString());
    res.cookie('token', token, sessionCookieOptions());
    res.status(200).redirect(await this.landingForUser(req, user.id));
  }

  async loginWithApple(req: express.Request, res: express.Response) {
    const { code, state } = req.body as { code?: string; state?: string };
    const stateCookie = req.cookies?.apple_login_state as string | undefined;

    if (!stateCookie || !state || state !== stateCookie) {
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_apple',
        code: 'oauth_state_mismatch',
        context: {
          hadStateCookie: stateCookie != null,
          hadStateParam: state != null,
          userAgent: req.headers?.['user-agent'] ?? null,
        },
      });
      return res.redirect('/login');
    }
    res.clearCookie('apple_login_state');

    if (!code) {
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_apple',
        code: 'oauth_cancelled',
      });
      return res.redirect('/login');
    }

    const loginRequest = await this.authService.loginWithApple(code);
    if (!loginRequest.ok) {
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_apple',
        code: 'oauth_token_exchange_failed',
        context: {
          reason: loginRequest.reason,
          message: loginRequest.message,
          userAgent: req.headers?.['user-agent'] ?? null,
        },
      });
      return res.redirect('/login');
    }

    const { subject, email, refreshToken } = loginRequest;
    const rawName = this.parseAppleName(req.body);
    const result = await this.#upsertAppleUser({
      subject,
      email,
      rawName,
      refreshToken,
      req,
    });

    if (result === 'email_missing') {
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_apple',
        code: 'oauth_email_missing',
      });
      return res.redirect('/login');
    }
    if (result === 'user_creation_failed') {
      console.info('Failed to create user');
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_apple',
        code: 'oauth_user_creation_failed',
      });
      return res
        .status(400)
        .send('Unknown error. Please try again or register a new account.');
    }
    if (result === 'token_failed') {
      console.info('Failed to create token');
      return res
        .status(400)
        .send('Unknown error. Please try again or register a new account.');
    }

    res.cookie('token', result.token, sessionCookieOptions());
    return res
      .status(200)
      .redirect(await this.landingForUser(req, result.user.id));
  }

  async loginWithAppleNative(req: express.Request, res: express.Response) {
    const body = req.body as {
      identityToken?: string;
      email?: string;
      fullName?: { givenName?: string; familyName?: string };
    };

    if (!body.identityToken) {
      return res.status(400).json({ error: 'missing_identity_token' });
    }

    const validated = await this.authService.verifyAppleIdentityToken(
      body.identityToken
    );
    if (!validated) {
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_apple_native',
        code: 'invalid_identity_token',
      });
      return res.status(401).json({ error: 'invalid_identity_token' });
    }

    const { subject, email } = validated;
    const rawName = this.parseNativeAppleName(body.fullName);
    const result = await this.#upsertAppleUser({
      subject,
      email,
      rawName,
      req,
    });

    if (result === 'email_missing') {
      return res.status(401).json({ error: 'email_required_for_new_account' });
    }
    if (result === 'user_creation_failed') {
      return res.status(401).json({ error: 'user_creation_failed' });
    }
    if (result === 'token_failed') {
      return res.status(500).json({ error: 'token_failed' });
    }

    res.cookie('token', result.token, sessionCookieOptions());
    return res.status(200).json({ ok: true });
  }

  async #upsertAppleUser({
    subject,
    email,
    rawName,
    refreshToken,
    req,
  }: {
    subject: string;
    email: string | undefined;
    rawName: string | undefined;
    refreshToken?: string;
    req: express.Request;
  }): Promise<
    | { user: { id: number; email?: string }; token: string }
    | 'email_missing'
    | 'user_creation_failed'
    | 'token_failed'
  > {
    const oauthIdentitiesRepo = new OauthIdentitiesRepository(this.db);
    const existingIdentity = await oauthIdentitiesRepo.findByProviderAndSubject(
      'apple',
      subject
    );

    let user = existingIdentity
      ? await this.userService.getUserById(existingIdentity.user_id.toString())
      : null;
    let isNewUser = false;

    if (existingIdentity && refreshToken) {
      await oauthIdentitiesRepo.updateRefreshToken(
        'apple',
        subject,
        refreshToken
      );
    }

    if (!user) {
      if (!email) {
        return 'email_missing';
      }
      const existingByEmail = await this.userService.getUserFrom(email);
      if (existingByEmail) {
        await oauthIdentitiesRepo.link(
          'apple',
          subject,
          existingByEmail.id,
          refreshToken
        );
        user = existingByEmail;
      } else {
        const hashedPassword =
          this.authService.getHashPassword(getRandomUUID());
        await this.userService.register(
          rawName ?? email,
          hashedPassword,
          email,
          readFirstTouchCookie(req).signupOrigin ?? 'apple'
        );
        user = await this.userService.getUserFrom(email);
        isNewUser = true;
        if (user) {
          await oauthIdentitiesRepo.link(
            'apple',
            subject,
            user.id,
            refreshToken
          );
          if (rawName) {
            await new UsersRepository(this.db).updateName(user.id, rawName);
          }
        }
      }
    }

    if (!user) {
      return 'user_creation_failed';
    }

    if (isNewUser) {
      try {
        const country = extractCountryFromRequest(req);
        if (country != null) {
          await new UsersRepository(this.db).setSignupCountryIfMissing(
            user.id,
            country
          );
        }
      } catch {
        // country capture is best-effort
      }
    }

    await this.userService.markEmailVerified(user.id.toString());

    const token = await this.authService.newJWTToken(user.id);
    if (!token) {
      return 'token_failed';
    }

    await this.authService.persistToken(token, user.id.toString());
    await this.userService.updateLastLoginAt(user.id.toString());

    return { user, token };
  }

  private parseAppleName(
    body: Record<string, string | undefined>
  ): string | undefined {
    const userField = body.user;
    if (!userField) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(userField) as {
        name?: { firstName?: string; lastName?: string };
      };
      const first =
        typeof parsed?.name?.firstName === 'string'
          ? parsed.name.firstName.trim()
          : '';
      const last =
        typeof parsed?.name?.lastName === 'string'
          ? parsed.name.lastName.trim()
          : '';
      const full = `${first} ${last}`.trim().slice(0, 200);
      return full.length > 0 ? full : undefined;
    } catch {
      return undefined;
    }
  }

  private parseNativeAppleName(
    fullName: { givenName?: string; familyName?: string } | undefined
  ): string | undefined {
    if (!fullName) {
      return undefined;
    }
    const first =
      typeof fullName.givenName === 'string' ? fullName.givenName.trim() : '';
    const last =
      typeof fullName.familyName === 'string' ? fullName.familyName.trim() : '';
    const full = `${first} ${last}`.trim().slice(0, 200);
    return full.length > 0 ? full : undefined;
  }

  async loginWithNotion(req: express.Request, res: express.Response) {
    const { code } = req.query;
    if (!code) {
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_notion',
        code: 'oauth_cancelled',
      });
      return res.redirect('/login?error=notion_cancelled');
    }

    const loginRequest = await this.authService.loginWithNotion(code as string);
    if (!loginRequest) {
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_notion',
        code: 'oauth_token_exchange_failed',
      });
      return res.redirect('/login?error=notion_cancelled');
    }

    const { email, name, accessData } = loginRequest;
    let user = await this.userService.getUserFrom(email);
    const isNewUser = !user;
    if (!user) {
      const hashedPassword = this.authService.getHashPassword(getRandomUUID());
      await this.userService.register(
        name,
        hashedPassword,
        email,
        readFirstTouchCookie(req).signupOrigin ?? 'notion_oauth'
      );
      user = await this.userService.getUserFrom(email);
    }
    if (isNewUser && user) {
      const country = extractCountryFromRequest(req);
      if (country != null) {
        await new UsersRepository(this.db).setSignupCountryIfMissing(
          user.id,
          country
        );
      }
    }

    if (!user) {
      console.info('Failed to create user from Notion login');
      await this.recordError?.execute({
        userId: null,
        surface: 'oauth_notion',
        code: 'oauth_user_creation_failed',
      });
      return res
        .status(400)
        .send('Unknown error. Please try again or register a new account.');
    }

    const token = await this.authService.newJWTToken(user.id);
    if (!token) {
      console.info('Failed to create token for Notion login');
      return res
        .status(400)
        .send('Unknown error. Please try again or register a new account.');
    }

    await this.authService.persistToken(token, user.id.toString());
    await this.userService.updateLastLoginAt(user.id.toString());

    const notionRepository = new NotionRepository(this.db);
    await notionRepository.saveNotionToken(user.id, accessData, hashToken);

    res.cookie('token', token, sessionCookieOptions());
    return res.status(200).redirect('/notion');
  }

  async requestMagicLink(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const { email, purpose: rawPurpose } = req.body;
    const purpose = rawPurpose ?? 'login';

    if (
      email == null ||
      typeof email !== 'string' ||
      email.trim().length === 0
    ) {
      return res.status(400).json({ message: 'Email is required' });
    }
    if (purpose !== 'login' && purpose !== 'password_reset') {
      return res.status(400).json({ message: 'Invalid purpose' });
    }

    try {
      await this.userService.requestMagicLink(email.trim(), purpose);
    } catch (error) {
      if (error instanceof MagicLinkRateLimitError) {
        return res.status(200).json({ message: 'ok' });
      }
      if (error instanceof MagicLinkSuppressedError) {
        return res
          .status(200)
          .json({ message: 'suppressed', suppressed: true });
      }
      return next(error);
    }
    return res.status(200).json({ message: 'ok' });
  }

  async verifyEmail(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const { token } = req.params;
    const sessionUser = await this.authService.getUserFrom(req.cookies?.token);
    const base = sessionUser ? '/account' : '/login';

    if (token == null || token.length === 0) {
      return res.redirect(`${base}?verify_error=expired`);
    }

    try {
      const result = await this.userService.verifyMagicToken(token);
      if (result?.purpose !== 'verify_email') {
        return res.redirect(`${base}?verify_error=expired`);
      }
      await this.userService.markEmailVerified(result.userId.toString());
      return res.redirect(`${base}?verified=1`);
    } catch (error) {
      console.error('Email verification failed:', error);
      next(error);
    }
  }

  async verifyMagicLink(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const { token } = req.params;
    if (token == null || token.length === 0) {
      return res.status(400).json({ message: 'Token is required' });
    }

    try {
      const result = await this.userService.verifyMagicToken(token);
      if (result == null) {
        return res
          .status(400)
          .json({ message: 'This link is invalid or has expired.' });
      }

      if (result.purpose === 'login') {
        const user = await this.userService.getUserById(
          result.userId.toString()
        );
        if (user == null) {
          return res
            .status(400)
            .json({ message: 'This link is invalid or has expired.' });
        }
        const jwtToken = await this.authService.newJWTToken(user.id);
        await this.authService.persistToken(jwtToken, user.id.toString());
        await this.userService.updateLastLoginAt(user.id.toString());
        await this.userService.markEmailVerified(user.id.toString());
        res.cookie('token', jwtToken, sessionCookieOptions());
        return res.status(200).json({ token: jwtToken });
      }

      if (result.purpose === 'password_reset') {
        const user = await this.userService.getUserById(
          result.userId.toString()
        );
        if (user == null) {
          return res
            .status(400)
            .json({ message: 'This link is invalid or has expired.' });
        }
        const resetToken = crypto.randomUUID();
        await this.userService.updateResetToken(user.id.toString(), resetToken);
        await this.userService.markEmailVerified(user.id.toString());
        return res
          .status(200)
          .json({ purpose: 'password_reset', reset_token: resetToken });
      }

      return res
        .status(400)
        .json({ message: 'This link is invalid or has expired.' });
    } catch (error) {
      console.error('Magic link verification failed:', error);
      next(error);
    }
  }

  async markOnboarded(_req: express.Request, res: express.Response) {
    const { owner } = res.locals;
    if (owner == null) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const repository = new UsersRepository(this.db);
    await repository.markOnboarded(owner);
    return res.status(204).end();
  }

  private hasExplicitRedirect(req: express.Request): boolean {
    const queryRedirect = req.query.redirect?.toString();
    const bodyRedirect =
      typeof req.body?.redirect === 'string' ? req.body.redirect : undefined;
    return (
      (queryRedirect != null && queryRedirect !== '') ||
      (bodyRedirect != null && bodyRedirect !== '')
    );
  }

  private async landingForUser(
    req: express.Request,
    userId: number
  ): Promise<string> {
    if (this.hasExplicitRedirect(req)) {
      return getRedirect(req);
    }
    const notionData = await new NotionRepository(this.db).getNotionData(
      userId
    );
    if (notionData != null) {
      return '/notion';
    }
    return '/upload';
  }
}

export default UsersController;
