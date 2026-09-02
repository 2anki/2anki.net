import type { IEmailChangeTokenRepository } from '../../data_layer/EmailChangeTokenRepository';
import type UsersRepository from '../../data_layer/UsersRepository';
import hmacToken from '../../lib/misc/hmacToken';

export type ConfirmEmailChangeOutcome =
  | { ok: true; userId: number }
  | { ok: false; reason: 'invalid_token' | 'email_taken' };

export class ConfirmEmailChangeUseCase {
  constructor(
    private readonly tokensRepo: IEmailChangeTokenRepository,
    private readonly usersRepo: UsersRepository,
    private readonly revokeSessions: (userId: number) => Promise<unknown>
  ) {}

  async execute(rawToken: string): Promise<ConfirmEmailChangeOutcome> {
    const trimmed = rawToken.trim();
    if (trimmed.length === 0) {
      return { ok: false, reason: 'invalid_token' };
    }

    const tokenRow = await this.tokensRepo.findByTokenHash(hmacToken(trimmed));
    if (
      tokenRow == null ||
      tokenRow.consumed_at != null ||
      new Date(tokenRow.expires_at).getTime() < Date.now()
    ) {
      return { ok: false, reason: 'invalid_token' };
    }

    const userId = Number(tokenRow.user_id);
    const nextEmail = tokenRow.new_email.trim().toLowerCase();

    const existing = await this.usersRepo.getByEmail(nextEmail);
    if (existing != null && Number(existing.id) !== userId) {
      return { ok: false, reason: 'email_taken' };
    }

    const result = await this.usersRepo.applyEmailChange({
      userId,
      newEmail: nextEmail,
      tokenId: Number(tokenRow.id),
    });

    if (!result.ok) {
      return result;
    }

    await this.revokeSessions(userId);
    return { ok: true, userId };
  }
}
