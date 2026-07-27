import crypto from 'crypto';

import UsersRepository from '../data_layer/UsersRepository';
import Users from '../data_layer/public/Users';
import AuthenticationService from './AuthenticationService';
import { IEmailService } from './EmailService/EmailService';
import type { IMagicTokenRepository } from '../data_layer/MagicTokenRepository';
import hashToken from '../lib/misc/hashToken';
import { isResetTokenLive } from '../lib/User/isResetTokenLive';

const MAGIC_LINK_RATE_LIMIT = 5;
const MAGIC_LINK_RATE_WINDOW_MS = 60 * 60 * 1000;
const MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000;

export class MagicLinkRateLimitError extends Error {
  constructor() {
    super('Too many magic link requests');
    this.name = 'MagicLinkRateLimitError';
  }
}

export class MagicLinkSuppressedError extends Error {
  constructor() {
    super('Recipient address is on the suppression list');
    this.name = 'MagicLinkSuppressedError';
  }
}

class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly emailService: IEmailService,
    private readonly magicTokenRepository?: IMagicTokenRepository
  ) {}

  updatePassword(password: string, resetToken: string) {
    return this.repository.updatePassword(password, resetToken);
  }

  updateResetToken(userId: string, resetToken: string) {
    return this.repository.updateResetToken(userId, resetToken);
  }

  async sendResetEmail(email: string, authService: AuthenticationService) {
    const user = await this.repository.getByEmail(email);
    if (!user?.id) {
      console.debug('no user found');
      return;
    }
    console.debug('user found');

    const resetToken = await this.getOrCreateResetToken(user, authService);
    await this.emailService.sendResetEmail(email, resetToken);
  }

  private async getOrCreateResetToken(
    user: Users,
    authService: AuthenticationService
  ) {
    // Reuse the outstanding token only while it is still inside its window.
    // A token that has expired (or predates the expiry column) must be
    // replaced, otherwise the user would be emailed a link the redeeming
    // query rejects and could never complete a reset.
    if (user.reset_token && isResetTokenLive(user)) {
      return user.reset_token;
    }
    const resetToken = authService.newResetToken();
    await this.repository.updateResetToken(user.id.toString(), resetToken);
    return resetToken;
  }

  // Resolves a reset token to its owner only while the token is still
  // redeemable. getByResetToken alone ignores the window, so callers that use
  // it for a privileged action would act on a token the redeem step refuses.
  async getUserByLiveResetToken(token: string): Promise<Users | null> {
    if (typeof token !== 'string' || token.length === 0) {
      return null;
    }
    const user = await this.repository.getByResetToken(token);
    if (!user || !isResetTokenLive(user)) {
      return null;
    }
    return user;
  }

  getUserFrom(email: string) {
    return this.repository.getByEmail(email);
  }

  async register(
    name: string,
    password: string,
    email: string,
    signupOrigin?: string | null
  ) {
    const normalizedEmail = email.toLowerCase();
    const trimmedName = name?.trim() ?? '';
    const resolvedName =
      trimmedName.length > 0 ? trimmedName : normalizedEmail.split('@')[0];
    return this.repository.createUserAndSeedFromTombstone(
      resolvedName,
      password,
      normalizedEmail,
      signupOrigin ?? null
    );
  }

  deleteUser(owner: any) {
    return this.repository.deleteUser(owner);
  }

  updateSubscriptionLinkedEmail(owner: string, email: string) {
    return this.repository.linkCurrentUserWithEmail(owner, email);
  }

  updateSubScriptionEmailUsingPrimaryEmail(email: string, newEmail: string) {
    return this.repository.updateSubScriptionEmailUsingPrimaryEmail(
      email,
      newEmail
    );
  }

  getSubscriptionLinkedEmail(owner: string) {
    return this.repository.getSubscriptionLinkedEmail(owner);
  }

  async checkSubscriptionEmailExists(email: string): Promise<boolean> {
    const subscription =
      await this.repository.checkSubscriptionEmailExists(email);
    return !!subscription;
  }

  getUserById(owner: string): Promise<Users> {
    return this.repository.getById(owner);
  }

  updateLastLoginAt(id: string) {
    return this.repository.updateLastLoginAt(id);
  }

  async requestHostedAnkiAccess(
    owner: string
  ): Promise<{ ok: boolean; alreadyRequested?: boolean }> {
    const user = await this.repository.getById(owner);
    if (user?.email == null) {
      return { ok: false };
    }
    if (user.hosted_anki_requested_at != null) {
      return { ok: true, alreadyRequested: true };
    }
    const result = await this.emailService.sendHostedAnkiAccessRequestEmail(
      String(user.id),
      user.email
    );
    if (!result.didSend) {
      return { ok: false };
    }
    await this.repository.markHostedAnkiRequested(owner);
    return { ok: true };
  }

  markAnkifyWelcomeSeen(owner: string) {
    return this.repository.markAnkifyWelcomeSeen(owner);
  }

  markEmailVerified(userId: string) {
    return this.repository.markEmailVerified(userId);
  }

  async requestMagicLink(
    email: string,
    purpose: 'login' | 'password_reset'
  ): Promise<void> {
    if (this.magicTokenRepository == null) {
      return;
    }
    const user = await this.repository.getByEmail(email);
    if (user?.id == null) {
      console.info('password_reset.magic_link', {
        outcome: 'unknown_email',
        purpose,
      });
      return;
    }
    const userIdHash = hashToken(String(user.id));
    const oneHourAgo = new Date(Date.now() - MAGIC_LINK_RATE_WINDOW_MS);
    const recentCount = await this.magicTokenRepository.countRecentByOwner(
      user.id,
      oneHourAgo
    );
    if (recentCount >= MAGIC_LINK_RATE_LIMIT) {
      console.info('password_reset.magic_link', {
        outcome: 'rate_limited',
        purpose,
        user_id_hash: userIdHash,
      });
      throw new MagicLinkRateLimitError();
    }
    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MS);
    await this.magicTokenRepository.create(token, user.id, purpose, expiresAt);
    let sendResult;
    try {
      sendResult = await this.emailService.sendMagicLinkEmail(
        email,
        token,
        purpose
      );
    } catch (error) {
      console.info('password_reset.magic_link', {
        outcome: 'send_failed',
        purpose,
        user_id_hash: userIdHash,
        error: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      throw error;
    }
    if (sendResult.suppressed) {
      console.info('password_reset.magic_link', {
        outcome: 'suppressed',
        purpose,
        user_id_hash: userIdHash,
      });
      throw new MagicLinkSuppressedError();
    }
    console.info('password_reset.magic_link', {
      outcome: 'sent',
      purpose,
      user_id_hash: userIdHash,
    });
  }

  async verifyMagicToken(
    token: string
  ): Promise<{ userId: number; purpose: string } | null> {
    if (this.magicTokenRepository == null) {
      return null;
    }
    const record = await this.magicTokenRepository.findValidToken(token);
    if (record == null) {
      return null;
    }
    await this.magicTokenRepository.markUsed(token);
    return { userId: record.owner, purpose: record.purpose };
  }
}

export default UsersService;
