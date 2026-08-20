import type { IAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import type {
  IUserPassRepository,
  PassKind,
} from '../../data_layer/UserPassRepository';
import type { EventsSink } from '../../services/events/EventsSink';

const DURATION_MS: Record<'24h' | '7d', number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export interface UsersByEmailRepository {
  getByEmail(email: string): Promise<{ id: number | string } | undefined>;
}

export interface GrantUnclaimedPassInput {
  anonymousPassId: number;
  email: string;
}

export type GrantUnclaimedPassOutcome =
  | { success: true; userId: number; kind: PassKind; expiresAt: Date }
  | {
      success: false;
      reason: 'pass_not_found' | 'user_not_found' | 'already_claimed';
    };

export class GrantUnclaimedPassUseCase {
  constructor(
    private readonly anonPassRepo: IAnonymousPassRepository,
    private readonly userPassRepo: IUserPassRepository,
    private readonly usersRepo: UsersByEmailRepository,
    private readonly eventsSink?: Pick<EventsSink, 'record'>
  ) {}

  async execute(
    input: GrantUnclaimedPassInput,
    now: Date = new Date()
  ): Promise<GrantUnclaimedPassOutcome> {
    const pass = await this.anonPassRepo.findById(input.anonymousPassId);
    if (pass == null || (pass.kind !== '24h' && pass.kind !== '7d')) {
      return { success: false, reason: 'pass_not_found' };
    }

    const user = await this.usersRepo.getByEmail(input.email);
    if (user == null) {
      return { success: false, reason: 'user_not_found' };
    }
    const userId = Number(user.id);

    if (pass.claimed_by_user_id != null && pass.claimed_by_user_id !== userId) {
      return { success: false, reason: 'already_claimed' };
    }

    if (pass.claimed_by_user_id == null) {
      const claimed = await this.anonPassRepo.claim(pass.id, userId);
      if (!claimed) {
        return { success: false, reason: 'already_claimed' };
      }
    }

    const expiresAt = new Date(now.getTime() + DURATION_MS[pass.kind]);
    const granted = await this.userPassRepo.upsertWithAbsoluteExpiry(
      userId,
      pass.kind,
      expiresAt,
      pass.payment_intent_id
    );

    this.eventsSink?.record({
      name: 'anonymous_pass_claimed',
      user_id: userId,
      props: { kind: pass.kind, method: 'ops' },
      created_at: now,
    });

    return {
      success: true,
      userId,
      kind: pass.kind,
      expiresAt: granted.expires_at,
    };
  }
}
