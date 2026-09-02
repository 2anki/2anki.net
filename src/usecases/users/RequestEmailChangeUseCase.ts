import crypto from 'node:crypto';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type { IEmailChangeTokenRepository } from '../../data_layer/EmailChangeTokenRepository';
import type UsersRepository from '../../data_layer/UsersRepository';
import type OauthIdentitiesRepository from '../../data_layer/OauthIdentitiesRepository';
import type { UsersId } from '../../data_layer/public/Users';
import hmacToken from '../../lib/misc/hmacToken';

const TOKEN_TTL_MS = 30 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_HOUR = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RequestEmailChangeReason =
  | 'invalid_email'
  | 'same_as_current'
  | 'wrong_password'
  | 'set_password_first'
  | 'email_taken'
  | 'rate_limited';

export type RequestEmailChangeOutcome =
  | { ok: true }
  | { ok: false; reason: RequestEmailChangeReason };

export interface RequestEmailChangeInput {
  userId: number;
  newEmail: string;
  password: string;
}

export class RequestEmailChangeUseCase {
  constructor(
    private readonly tokensRepo: IEmailChangeTokenRepository,
    private readonly usersRepo: UsersRepository,
    private readonly oauthRepo: OauthIdentitiesRepository,
    private readonly emailService: IEmailService,
    private readonly comparePassword: (plain: string, hash: string) => boolean,
    private readonly domain: string = process.env.DOMAIN ?? 'https://2anki.net'
  ) {}

  async execute(
    input: RequestEmailChangeInput
  ): Promise<RequestEmailChangeOutcome> {
    const nextEmail = input.newEmail.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(nextEmail)) {
      return { ok: false, reason: 'invalid_email' };
    }

    const user = await this.usersRepo.getById(String(input.userId));
    if (user == null) {
      return { ok: false, reason: 'invalid_email' };
    }

    const currentEmail = user.email.trim().toLowerCase();
    if (nextEmail === currentEmail) {
      return { ok: false, reason: 'same_as_current' };
    }

    if (!this.comparePassword(input.password, user.password)) {
      const hasOauth = await this.oauthRepo.hasIdentityForUser(input.userId);
      return {
        ok: false,
        reason: hasOauth ? 'set_password_first' : 'wrong_password',
      };
    }

    const existing = await this.usersRepo.getByEmail(nextEmail);
    if (existing != null && String(existing.id) !== String(input.userId)) {
      return { ok: false, reason: 'email_taken' };
    }

    const hourAgo = new Date(Date.now() - ONE_HOUR_MS);
    const recent = await this.tokensRepo.countRecentByUser(
      input.userId,
      hourAgo
    );
    if (recent >= MAX_REQUESTS_PER_HOUR) {
      return { ok: false, reason: 'rate_limited' };
    }

    const rawToken = crypto.randomUUID();
    await this.tokensRepo.insert({
      user_id: input.userId as UsersId,
      new_email: nextEmail,
      token_hash: hmacToken(rawToken),
      expires_at: new Date(Date.now() + TOKEN_TTL_MS),
    });

    const confirmUrl = `${this.domain}/account/email-change?token=${encodeURIComponent(rawToken)}`;
    await this.emailService.sendEmailChangeConfirmationEmail(
      nextEmail,
      confirmUrl
    );
    await this.emailService.sendEmailChangeNotificationEmail(
      currentEmail,
      nextEmail
    );

    return { ok: true };
  }
}
