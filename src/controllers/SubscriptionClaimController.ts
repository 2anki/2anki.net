import type { Request, Response } from 'express';
import type { ClaimSubscriptionUseCase } from '../usecases/subscriptions/ClaimSubscriptionUseCase';
import type { ConfirmSubscriptionClaimUseCase } from '../usecases/subscriptions/ConfirmSubscriptionClaimUseCase';
import type { ClaimPassUseCase } from '../usecases/passes/ClaimPassUseCase';
import type { ConfirmPassClaimUseCase } from '../usecases/passes/ConfirmPassClaimUseCase';
import { passKindLabel } from '../usecases/passes/passKindLabel';
import { emailHash } from '../lib/emailHash';
import hmacToken from '../lib/misc/hmacToken';
import { resolveClientIp } from '../lib/rateLimit/ipHelpers';
import { track } from '../services/events/track';

export class SubscriptionClaimController {
  constructor(
    private readonly claimUseCase: ClaimSubscriptionUseCase,
    private readonly confirmUseCase: ConfirmSubscriptionClaimUseCase,
    private readonly claimPassUseCase: ClaimPassUseCase,
    private readonly confirmPassUseCase: ConfirmPassClaimUseCase
  ) {}

  async initiate(req: Request, res: Response): Promise<void> {
    const userId = res.locals.owner as number;
    const submittedEmail: string = (req.body?.email ?? '').trim().toLowerCase();

    if (!submittedEmail.includes('@')) {
      res.status(400).json({ message: 'Invalid email address.' });
      return;
    }

    const ip = resolveClientIp(req);
    const input = {
      userId,
      submittedEmail,
      ipHash: hmacToken(ip),
      emailHash: emailHash(submittedEmail),
    };

    const result = await this.claimUseCase.execute(input);
    try {
      await this.claimPassUseCase.execute(input);
    } catch (error) {
      // The generic response must not change when the pass branch fails —
      // log and keep the anti-enumeration contract.
      console.error('pass.claim.initiate_failed', error);
    }

    res.status(200).json({ message: result.message });
  }

  async confirm(req: Request, res: Response): Promise<void> {
    const userId = res.locals.owner as number;
    const rawToken: string = (req.body?.token ?? '').trim();

    if (!rawToken) {
      res.status(400).json({ message: 'Token is required.' });
      return;
    }

    const ip = resolveClientIp(req);
    const ipHashValue = hmacToken(ip);
    const placeholderEmailHash = hmacToken('unknown');

    const outcome = await this.confirmUseCase.execute(
      userId,
      rawToken,
      ipHashValue,
      placeholderEmailHash
    );

    if (outcome.success) {
      res.status(200).json({ message: 'Subscription claimed.' });
      return;
    }

    if (outcome.reason === 'already_consumed') {
      res.status(409).json({
        message:
          'This link is already used. Sign in and try again from /account if you need to reclaim.',
      });
      return;
    }

    if (outcome.reason === 'user_has_active_sub') {
      res.status(409).json({
        message:
          'This account already has an active subscription. Cancel it first or contact support.',
      });
      return;
    }

    res.status(400).json({
      message:
        'Invalid or expired confirmation link. Start over from /account.',
    });
  }

  async confirmPass(req: Request, res: Response): Promise<void> {
    const userId = res.locals.owner as number;
    const rawToken: string = (req.body?.token ?? '').trim();

    if (!rawToken) {
      res.status(400).json({ message: 'Token is required.' });
      return;
    }

    const ip = resolveClientIp(req);
    const outcome = await this.confirmPassUseCase.execute(
      userId,
      rawToken,
      hmacToken(ip),
      hmacToken('unknown')
    );

    if (outcome.success) {
      track('anonymous_pass_claimed', {
        userId,
        props: { kind: outcome.passKind, method: 'link' },
      });
      res.status(200).json({
        kind: 'pass',
        passKind: passKindLabel(outcome.passKind),
        expiresAt: outcome.expiresAt.toISOString(),
      });
      return;
    }

    if (outcome.reason === 'already_claimed') {
      res.status(409).json({ reason: 'already_claimed' });
      return;
    }

    if (outcome.reason === 'pass_expired') {
      res.status(410).json({ reason: 'pass_expired' });
      return;
    }

    res.status(400).json({ reason: 'invalid_token' });
  }
}
