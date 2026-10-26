import { vi } from 'vitest';
import {
  DeleteAccountByEmailUseCase,
  DeleteAccountDeps,
} from './DeleteAccountByEmailUseCase';

const NOW = new Date('2026-10-26T12:00:00Z');

const target = {
  id: 4242,
  email: 'target@example.com',
  created_at: new Date('2026-10-26T06:00:00Z'),
  last_login_at: null,
};

const makeDeps = (overrides: Partial<DeleteAccountDeps> = {}) => {
  const order: string[] = [];
  const deps: DeleteAccountDeps = {
    accounts: {
      findUserByEmail: vi.fn().mockResolvedValue(target),
      countActivity: vi.fn().mockResolvedValue({ jobs: 2, uploads: 1 }),
    },
    entitlements: {
      hasActiveSubscription: vi.fn().mockResolvedValue(false),
      findActivePass: vi.fn().mockResolvedValue(null),
    },
    billing: {
      cancelAllSubscriptions: vi.fn().mockImplementation(async () => {
        order.push('cancel');
      }),
    },
    appleTokens: {
      revokeForUser: vi.fn().mockImplementation(async () => {
        order.push('revoke');
      }),
    },
    deleter: {
      deleteUser: vi.fn().mockImplementation(async () => {
        order.push('delete');
      }),
    },
    ...overrides,
  };
  return { deps, order };
};

const input = {
  email: 'target@example.com',
  dryRun: false,
  force: false,
  operatorId: 1,
};

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DeleteAccountByEmailUseCase', () => {
  it('returns not_found when no account uses the email', async () => {
    const { deps } = makeDeps();
    vi.mocked(deps.accounts.findUserByEmail).mockResolvedValue(undefined);

    await expect(
      new DeleteAccountByEmailUseCase(deps).execute(input, NOW)
    ).resolves.toEqual({ status: 'not_found' });
    expect(deps.deleter.deleteUser).not.toHaveBeenCalled();
  });

  it('previews the account and deletes nothing on a dry run', async () => {
    const { deps } = makeDeps();

    const outcome = await new DeleteAccountByEmailUseCase(deps).execute(
      { ...input, dryRun: true },
      NOW
    );

    expect(outcome).toEqual({
      status: 'preview',
      account: {
        userId: 4242,
        createdAt: '2026-10-26T06:00:00.000Z',
        lastLoginAt: null,
        activeSubscription: false,
        activePass: null,
        jobs: 2,
        uploads: 1,
      },
    });
    expect(deps.billing.cancelAllSubscriptions).not.toHaveBeenCalled();
    expect(deps.deleter.deleteUser).not.toHaveBeenCalled();
  });

  it('cancels Stripe, revokes Apple, then deletes, in that order', async () => {
    const { deps, order } = makeDeps();

    await expect(
      new DeleteAccountByEmailUseCase(deps).execute(input, NOW)
    ).resolves.toEqual({ status: 'deleted', userId: 4242 });

    expect(deps.billing.cancelAllSubscriptions).toHaveBeenCalledWith(
      'target@example.com'
    );
    expect(deps.appleTokens.revokeForUser).toHaveBeenCalledWith(4242);
    expect(deps.deleter.deleteUser).toHaveBeenCalledWith('4242');
    expect(order).toEqual(['cancel', 'revoke', 'delete']);
  });

  it('refuses an account with an active subscription unless forced', async () => {
    const { deps } = makeDeps();
    vi.mocked(deps.entitlements.hasActiveSubscription).mockResolvedValue(true);

    const outcome = await new DeleteAccountByEmailUseCase(deps).execute(
      input,
      NOW
    );

    expect(outcome.status).toBe('paid');
    expect(deps.billing.cancelAllSubscriptions).not.toHaveBeenCalled();
    expect(deps.deleter.deleteUser).not.toHaveBeenCalled();
  });

  it('refuses an account with an unexpired pass unless forced', async () => {
    const { deps } = makeDeps();
    vi.mocked(deps.entitlements.findActivePass).mockResolvedValue({
      kind: '7d',
      expires_at: new Date('2026-10-30T00:00:00Z'),
    });

    const outcome = await new DeleteAccountByEmailUseCase(deps).execute(
      input,
      NOW
    );

    expect(outcome).toMatchObject({
      status: 'paid',
      account: {
        activePass: { kind: '7d', expiresAt: '2026-10-30T00:00:00.000Z' },
      },
    });
    expect(deps.deleter.deleteUser).not.toHaveBeenCalled();
  });

  it('deletes a paid account when forced', async () => {
    const { deps } = makeDeps();
    vi.mocked(deps.entitlements.hasActiveSubscription).mockResolvedValue(true);

    await expect(
      new DeleteAccountByEmailUseCase(deps).execute(
        { ...input, force: true },
        NOW
      )
    ).resolves.toEqual({ status: 'deleted', userId: 4242 });
    expect(deps.billing.cancelAllSubscriptions).toHaveBeenCalled();
  });

  it('deletes nothing when the Stripe cancel fails', async () => {
    const { deps } = makeDeps();
    vi.mocked(deps.billing.cancelAllSubscriptions).mockRejectedValue(
      Object.assign(new Error('stripe down'), { code: 'api_error' })
    );

    await expect(
      new DeleteAccountByEmailUseCase(deps).execute(input, NOW)
    ).resolves.toEqual({ status: 'billing_failed' });
    expect(deps.appleTokens.revokeForUser).not.toHaveBeenCalled();
    expect(deps.deleter.deleteUser).not.toHaveBeenCalled();
  });

  it("refuses the operator's own account, even as a preview", async () => {
    const { deps } = makeDeps();

    await expect(
      new DeleteAccountByEmailUseCase(deps).execute(
        { ...input, dryRun: true, operatorId: 4242 },
        NOW
      )
    ).resolves.toEqual({ status: 'own_account' });
    expect(deps.deleter.deleteUser).not.toHaveBeenCalled();
  });
});
