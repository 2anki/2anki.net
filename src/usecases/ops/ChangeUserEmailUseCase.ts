import type { EventsSink } from '../../services/events/EventsSink';
import type { StripeCustomerEmails } from '../../services/StripeCustomerEmailService';
import {
  type BillingEmailRepository,
  moveBillingEmail,
} from '../users/moveBillingEmail';

export interface ChangeUserEmailRepository extends BillingEmailRepository {
  getByEmail(email: string): Promise<{ id: number | string } | undefined>;
  changeEmailAndRelinkSubscriptions(
    currentEmail: string,
    newEmail: string
  ): Promise<void>;
}

export interface ChangeUserEmailInput {
  currentEmail: string;
  newEmail: string;
}

export type ChangeUserEmailOutcome =
  | { success: true; userId: number }
  | {
      success: false;
      reason:
        | 'user_not_found'
        | 'new_email_taken'
        | 'same_email'
        | 'payer_relay_address'
        | 'stripe_update_failed';
    };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class ChangeUserEmailUseCase {
  constructor(
    private readonly usersRepo: ChangeUserEmailRepository,
    private readonly stripeCustomers: StripeCustomerEmails,
    private readonly eventsSink?: Pick<EventsSink, 'record'>
  ) {}

  async execute(
    input: ChangeUserEmailInput,
    now: Date = new Date()
  ): Promise<ChangeUserEmailOutcome> {
    const currentEmail = normalizeEmail(input.currentEmail);
    const newEmail = normalizeEmail(input.newEmail);

    if (currentEmail === newEmail) {
      return { success: false, reason: 'same_email' };
    }

    const user = await this.usersRepo.getByEmail(currentEmail);
    if (user == null) {
      return { success: false, reason: 'user_not_found' };
    }
    const userId = Number(user.id);

    const existing = await this.usersRepo.getByEmail(newEmail);
    if (existing != null && Number(existing.id) !== userId) {
      return { success: false, reason: 'new_email_taken' };
    }

    const billing = await moveBillingEmail(
      this.usersRepo,
      this.stripeCustomers,
      { userId, currentEmail, newEmail }
    );
    if (!billing.ok) {
      return {
        success: false,
        reason:
          billing.reason === 'subscription_address_taken'
            ? 'new_email_taken'
            : billing.reason,
      };
    }

    try {
      await this.usersRepo.changeEmailAndRelinkSubscriptions(
        currentEmail,
        newEmail
      );
    } catch (error) {
      await billing.revert();
      throw error;
    }

    this.eventsSink?.record({
      name: 'ops_user_email_changed',
      user_id: userId,
      props: { method: 'ops' },
      created_at: now,
    });

    return { success: true, userId };
  }
}
