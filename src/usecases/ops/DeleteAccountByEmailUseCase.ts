import type {
  AccountActivityCounts,
  AccountDeletionTarget,
} from '../../data_layer/AccountDeletionPreviewRepository';

export interface DeleteAccountDeps {
  accounts: {
    findUserByEmail(email: string): Promise<AccountDeletionTarget | undefined>;
    countActivity(userId: number): Promise<AccountActivityCounts>;
  };
  entitlements: {
    hasActiveSubscription(email: string): Promise<boolean>;
    findActivePass(
      userId: number,
      now: Date
    ): Promise<{ kind: string; expires_at: Date } | null>;
  };
  // Same three steps, in the same order, as self-serve deletion
  // (UsersController.deleteAccount): cancel Stripe, revoke Apple, delete.
  billing: { cancelAllSubscriptions(email: string): Promise<void> };
  appleTokens: { revokeForUser(userId: number): Promise<void> };
  deleter: { deleteUser(owner: string): Promise<unknown> };
}

export interface DeleteAccountInput {
  email: string;
  dryRun: boolean;
  force: boolean;
  operatorId: number;
}

export interface AccountSummary {
  userId: number;
  createdAt: string | null;
  lastLoginAt: string | null;
  activeSubscription: boolean;
  activePass: { kind: string; expiresAt: string } | null;
  jobs: number;
  uploads: number;
}

export type DeleteAccountOutcome =
  | { status: 'not_found' }
  | { status: 'own_account' }
  | { status: 'preview'; account: AccountSummary }
  | { status: 'paid'; account: AccountSummary }
  | { status: 'billing_failed' }
  | { status: 'deleted'; userId: number };

const iso = (value: Date | null): string | null =>
  value == null ? null : new Date(value).toISOString();

export class DeleteAccountByEmailUseCase {
  constructor(private readonly deps: DeleteAccountDeps) {}

  private async summarize(
    user: AccountDeletionTarget,
    now: Date
  ): Promise<AccountSummary> {
    const userId = Number(user.id);
    const [activeSubscription, pass, activity] = await Promise.all([
      this.deps.entitlements.hasActiveSubscription(user.email),
      this.deps.entitlements.findActivePass(userId, now),
      this.deps.accounts.countActivity(userId),
    ]);
    return {
      userId,
      createdAt: iso(user.created_at),
      lastLoginAt: iso(user.last_login_at),
      activeSubscription,
      activePass:
        pass == null
          ? null
          : {
              kind: pass.kind,
              expiresAt: new Date(pass.expires_at).toISOString(),
            },
      jobs: activity.jobs,
      uploads: activity.uploads,
    };
  }

  async execute(
    input: DeleteAccountInput,
    now: Date = new Date()
  ): Promise<DeleteAccountOutcome> {
    const user = await this.deps.accounts.findUserByEmail(input.email);
    if (user == null) {
      return { status: 'not_found' };
    }
    const userId = Number(user.id);
    if (userId === input.operatorId) {
      return { status: 'own_account' };
    }

    const account = await this.summarize(user, now);
    if (input.dryRun) {
      return { status: 'preview', account };
    }
    // Paid access is never removed by a typo: it takes a second, explicit
    // force on top of the typed confirmation.
    const paid = account.activeSubscription || account.activePass != null;
    if (paid && !input.force) {
      return { status: 'paid', account };
    }

    // A failed Stripe cancel must block the deletion: with the account gone
    // there is nobody left to retry from, and the plan would keep billing.
    try {
      await this.deps.billing.cancelAllSubscriptions(user.email);
    } catch (error) {
      console.error('[ops] delete-user stripe cancel failed', {
        user_id: userId,
        error_code: (error as { code?: string }).code,
      });
      return { status: 'billing_failed' };
    }
    await this.deps.appleTokens.revokeForUser(userId);
    await this.deps.deleter.deleteUser(String(userId));

    console.info('[ops] delete-user', {
      operator_id: input.operatorId,
      user_id: userId,
      forced: paid,
    });
    return { status: 'deleted', userId };
  }
}
