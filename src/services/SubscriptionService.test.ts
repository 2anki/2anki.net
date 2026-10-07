import { vi, type Mock } from 'vitest';
vi.mock('../data_layer', () => ({
  getDatabase: vi.fn(),
}));

vi.mock('../lib/integrations/stripe', () => ({
  getStripe: vi.fn(),
}));

vi.mock('./EmailService/EmailService', () => ({
  getDefaultEmailService: vi.fn(),
}));

import { getDatabase } from '../data_layer';
import { getStripe } from '../lib/integrations/stripe';
import { getDefaultEmailService } from './EmailService/EmailService';
import SubscriptionService, {
  SubscriptionNotOwnedError,
  AnnualPlanNotPausableError,
  SubscriptionTooNewToPauseError,
  InvalidPauseMonthsError,
} from './SubscriptionService';

function buildDbMock(linkedRows: Array<{ email: string }> = []): Mock & {
  updateSpy: Mock;
  deleteSpy: Mock;
  whereRawSpy: Mock;
} {
  const updateSpy = vi.fn().mockResolvedValue(0);
  const deleteSpy = vi.fn().mockResolvedValue(0);
  const whereRawSpy = vi.fn().mockReturnThis();
  const queryBuilder: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    whereRaw: whereRawSpy,
    andWhere: vi.fn().mockReturnThis(),
    orWhere: vi.fn().mockReturnThis(),
    update: updateSpy,
    delete: deleteSpy,
    then: (resolve: (value: unknown) => void) => resolve(linkedRows),
  };
  const db = vi.fn().mockReturnValue(queryBuilder) as Mock & {
    updateSpy: Mock;
    deleteSpy: Mock;
    whereRawSpy: Mock;
  };
  db.updateSpy = updateSpy;
  db.deleteSpy = deleteSpy;
  db.whereRawSpy = whereRawSpy;
  return db;
}

type StripeMock = {
  customers: { list: Mock; search: Mock };
  subscriptions: {
    list: Mock;
    update: Mock;
    cancel: Mock;
  };
};

function buildStripeMock(overrides: Partial<StripeMock> = {}): StripeMock {
  return {
    customers: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      search: vi.fn().mockResolvedValue({ data: [] }),
    },
    subscriptions: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      update: vi.fn().mockResolvedValue({}),
      cancel: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

const email = 'user@example.com';
const periodEndSeconds = 1800000000;

const activeSub = {
  id: 'sub_123',
  status: 'active',
  cancel_at_period_end: false,
  cancel_at: null,
};

describe('SubscriptionService.findActiveStripeSubscriptions', () => {
  let stripe: StripeMock;

  beforeEach(() => {
    vi.clearAllMocks();
    stripe = buildStripeMock();
    (getStripe as Mock).mockReturnValue(stripe);
    (getDatabase as Mock).mockReturnValue(buildDbMock());
    (getDefaultEmailService as Mock).mockReturnValue({});
  });

  it('returns active subscriptions for the user email', async () => {
    stripe.customers.list.mockResolvedValue({
      data: [{ id: 'cus_1', email }],
    });
    stripe.subscriptions.list.mockResolvedValue({ data: [activeSub] });

    const result =
      await SubscriptionService.findActiveStripeSubscriptions(email);

    expect(stripe.customers.list).toHaveBeenCalledWith({
      email,
      limit: 10,
    });
    expect(stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: 'cus_1',
      status: 'active',
      limit: 10,
    });
    expect(result).toEqual([activeSub]);
  });

  it('returns an empty array when Stripe has no customer for the email', async () => {
    stripe.customers.list.mockResolvedValue({ data: [] });

    const result =
      await SubscriptionService.findActiveStripeSubscriptions(email);

    expect(result).toEqual([]);
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
  });

  it('also looks up subscriptions under linked Stripe emails', async () => {
    (getDatabase as Mock).mockReturnValue(
      buildDbMock([{ email: 'stripe@example.com' }])
    );
    stripe.customers.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [{ id: 'cus_2', email: 'stripe@example.com' }],
      });
    stripe.subscriptions.list.mockResolvedValue({ data: [activeSub] });

    const result =
      await SubscriptionService.findActiveStripeSubscriptions(email);

    expect(stripe.customers.list).toHaveBeenCalledWith({
      email: 'stripe@example.com',
      limit: 10,
    });
    expect(result).toEqual([activeSub]);
  });

  it('dedupes subscriptions returned under multiple customers', async () => {
    stripe.customers.list.mockResolvedValue({
      data: [
        { id: 'cus_1', email },
        { id: 'cus_2', email },
      ],
    });
    stripe.subscriptions.list.mockResolvedValue({ data: [activeSub] });

    const result =
      await SubscriptionService.findActiveStripeSubscriptions(email);

    expect(result).toHaveLength(1);
  });

  it('resolves a mixed-case Stripe customer email for a lowercased submission', async () => {
    const mixedCaseCustomer = {
      id: 'cus_mixed',
      email: 'User.Name@Example.com',
    };
    stripe.customers.list.mockResolvedValue({ data: [] });
    stripe.customers.search.mockResolvedValue({ data: [mixedCaseCustomer] });
    stripe.subscriptions.list.mockResolvedValue({ data: [activeSub] });

    const result = await SubscriptionService.findActiveStripeSubscriptions(
      'user.name@example.com'
    );

    expect(stripe.customers.search).toHaveBeenCalledWith({
      query: "email:'user.name@example.com'",
      limit: 10,
    });
    expect(stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: 'cus_mixed',
      status: 'active',
      limit: 10,
    });
    expect(result).toEqual([activeSub]);
  });

  it('does not fall back to search when list already finds the customer', async () => {
    stripe.customers.list.mockResolvedValue({ data: [{ id: 'cus_1', email }] });
    stripe.subscriptions.list.mockResolvedValue({ data: [activeSub] });

    await SubscriptionService.findActiveStripeSubscriptions(email);

    expect(stripe.customers.search).not.toHaveBeenCalled();
  });
});

describe('SubscriptionService.findRecentStripeSubscriptions', () => {
  let stripe: StripeMock;

  beforeEach(() => {
    vi.clearAllMocks();
    stripe = buildStripeMock();
    (getStripe as Mock).mockReturnValue(stripe);
    (getDatabase as Mock).mockReturnValue(buildDbMock());
    (getDefaultEmailService as Mock).mockReturnValue({});
  });

  it('returns subscriptions with any status from Stripe', async () => {
    const canceled = {
      id: 'sub_old',
      status: 'canceled',
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: periodEndSeconds - 100,
    };
    stripe.customers.list.mockResolvedValue({
      data: [{ id: 'cus_1', email }],
    });
    stripe.subscriptions.list.mockResolvedValue({
      data: [activeSub, canceled],
    });

    const result =
      await SubscriptionService.findRecentStripeSubscriptions(email);

    expect(stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: 'cus_1',
      status: 'all',
      limit: 10,
    });
    expect(result).toEqual([activeSub, canceled]);
  });

  it('returns empty array when Stripe has no customer for email', async () => {
    stripe.customers.list.mockResolvedValue({ data: [] });

    const result =
      await SubscriptionService.findRecentStripeSubscriptions(email);

    expect(result).toEqual([]);
  });
});

describe('SubscriptionService.cancelUserSubscriptions', () => {
  let stripe: StripeMock;
  let sendScheduledEmail: Mock;
  let sendCancelledEmail: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    stripe = buildStripeMock();
    (getStripe as Mock).mockReturnValue(stripe);
    (getDatabase as Mock).mockReturnValue(buildDbMock());

    sendScheduledEmail = vi.fn().mockResolvedValue(undefined);
    sendCancelledEmail = vi.fn().mockResolvedValue(undefined);
    (getDefaultEmailService as Mock).mockReturnValue({
      sendSubscriptionScheduledCancellationEmail: sendScheduledEmail,
      sendSubscriptionCancelledEmail: sendCancelledEmail,
    });

    stripe.customers.list.mockResolvedValue({
      data: [{ id: 'cus_1', email }],
    });
    stripe.subscriptions.list.mockResolvedValue({ data: [activeSub] });
    stripe.subscriptions.update.mockResolvedValue({
      ...activeSub,
      cancel_at_period_end: true,
      cancel_at: periodEndSeconds,
    });
    stripe.subscriptions.cancel.mockResolvedValue({
      ...activeSub,
      status: 'canceled',
      canceled_at: periodEndSeconds,
      ended_at: periodEndSeconds,
    });
  });

  it('schedules cancellation at period end by default', async () => {
    await SubscriptionService.cancelUserSubscriptions(email);

    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_123', {
      cancel_at_period_end: true,
    });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(sendScheduledEmail).toHaveBeenCalledTimes(1);
    expect(sendCancelledEmail).not.toHaveBeenCalled();
  });

  it('cancels immediately when mode is "immediate"', async () => {
    await SubscriptionService.cancelUserSubscriptions(email, 'immediate');

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_123');
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(sendCancelledEmail).toHaveBeenCalledTimes(1);
    expect(sendScheduledEmail).not.toHaveBeenCalled();
  });

  it('soft-deletes the local DB subscription row on immediate cancel so churn keeps it', async () => {
    const db = buildDbMock();
    (getDatabase as Mock).mockReturnValue(db);

    await SubscriptionService.cancelUserSubscriptions(email, 'immediate');

    expect(db.deleteSpy).not.toHaveBeenCalled();
    expect(db.updateSpy).toHaveBeenCalledTimes(1);
    const updatePayload = db.updateSpy.mock.calls[0][0] as {
      active: boolean;
      payload: string;
      updated_at: Date;
    };
    expect(updatePayload.active).toBe(false);
    expect(JSON.parse(updatePayload.payload).status).toBe('canceled');
    expect(updatePayload.updated_at).toBeInstanceOf(Date);
    expect(db.whereRawSpy).toHaveBeenCalledWith("payload->>'id' = ?", [
      'sub_123',
    ]);
  });

  it('stamps updated_at when deactivating a row by id', async () => {
    const db = buildDbMock();
    (getDatabase as Mock).mockReturnValue(db);

    await new SubscriptionService().deactivateSubscription(4374);

    expect(db.updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, updated_at: expect.any(Date) })
    );
  });

  it('does not touch the DB for period_end cancel', async () => {
    const db = buildDbMock();
    (getDatabase as Mock).mockReturnValue(db);

    await SubscriptionService.cancelUserSubscriptions(email, 'period_end');

    expect(db.updateSpy).not.toHaveBeenCalled();
    expect(db.deleteSpy).not.toHaveBeenCalled();
  });

  it('returns the count of processed subscriptions', async () => {
    stripe.subscriptions.list.mockResolvedValue({
      data: [activeSub, { ...activeSub, id: 'sub_456' }],
    });

    const result = await SubscriptionService.cancelUserSubscriptions(email);

    expect(result).toBe(2);
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(2);
  });

  it('returns 0 when Stripe has no active subscriptions', async () => {
    stripe.subscriptions.list.mockResolvedValue({ data: [] });

    const result = await SubscriptionService.cancelUserSubscriptions(email);

    expect(result).toBe(0);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('propagates Stripe API errors', async () => {
    stripe.subscriptions.update.mockRejectedValue(new Error('stripe is down'));

    await expect(
      SubscriptionService.cancelUserSubscriptions(email)
    ).rejects.toThrow('stripe is down');
  });

  it('cancels non-active subscriptions when allStatuses is true', async () => {
    const pastDueSub = { ...activeSub, id: 'sub_past', status: 'past_due' };
    stripe.subscriptions.list.mockResolvedValue({ data: [pastDueSub] });

    const result = await SubscriptionService.cancelUserSubscriptions(
      email,
      'immediate',
      true
    );

    expect(stripe.subscriptions.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'all' })
    );
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_past');
    expect(result).toBe(1);
  });

  it('skips already-canceled subscriptions when allStatuses is true', async () => {
    const canceledSub = { ...activeSub, id: 'sub_old', status: 'canceled' };
    stripe.subscriptions.list.mockResolvedValue({
      data: [activeSub, canceledSub],
    });

    const result = await SubscriptionService.cancelUserSubscriptions(
      email,
      'immediate',
      true
    );

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_123');
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalledWith('sub_old');
    expect(result).toBe(1);
  });

  it('never writes the user email to the logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await SubscriptionService.cancelUserSubscriptions(email);

      const leakedEmail = logSpy.mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes(email))
      );
      expect(leakedEmail).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('SubscriptionService.cancelSubscriptionById', () => {
  let stripe: StripeMock;

  const ownedSub = { ...activeSub, id: 'sub_owned' };
  const siblingSub = { ...activeSub, id: 'sub_sibling' };

  beforeEach(() => {
    vi.clearAllMocks();
    stripe = buildStripeMock();
    (getStripe as Mock).mockReturnValue(stripe);
    (getDatabase as Mock).mockReturnValue(buildDbMock());
    (getDefaultEmailService as Mock).mockReturnValue({});

    stripe.customers.list.mockResolvedValue({ data: [{ id: 'cus_1', email }] });
    stripe.subscriptions.list.mockResolvedValue({
      data: [ownedSub, siblingSub],
    });
  });

  it('cancels the matching subscription immediately', async () => {
    await SubscriptionService.cancelSubscriptionById(
      email,
      'sub_owned',
      'immediate'
    );

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_owned');
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalledWith('sub_sibling');
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('schedules cancellation at period end when mode is period_end', async () => {
    await SubscriptionService.cancelSubscriptionById(
      email,
      'sub_owned',
      'period_end'
    );

    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_owned', {
      cancel_at_period_end: true,
    });
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('cancels a past_due subscription immediately and soft-deletes its DB row', async () => {
    const db = buildDbMock();
    (getDatabase as Mock).mockReturnValue(db);
    const pastDueSub = { ...activeSub, id: 'sub_due', status: 'past_due' };
    stripe.subscriptions.list.mockResolvedValue({ data: [pastDueSub] });
    stripe.subscriptions.cancel.mockResolvedValue({
      id: 'sub_due',
      status: 'canceled',
      canceled_at: periodEndSeconds,
      ended_at: periodEndSeconds,
    });

    await SubscriptionService.cancelSubscriptionById(
      email,
      'sub_due',
      'immediate'
    );

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_due');
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(db.whereRawSpy).toHaveBeenCalledWith("payload->>'id' = ?", [
      'sub_due',
    ]);
    expect(db.updateSpy).toHaveBeenCalledTimes(1);
    const updatePayload = db.updateSpy.mock.calls[0][0] as { active: boolean };
    expect(updatePayload.active).toBe(false);
  });

  it('throws SubscriptionNotOwnedError and never calls Stripe when the id is not owned', async () => {
    await expect(
      SubscriptionService.cancelSubscriptionById(
        email,
        'sub_other',
        'immediate'
      )
    ).rejects.toBeInstanceOf(SubscriptionNotOwnedError);

    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('soft-deletes only the targeted DB row scoped by the Stripe id on immediate cancel', async () => {
    const db = buildDbMock();
    (getDatabase as Mock).mockReturnValue(db);
    stripe.subscriptions.cancel.mockResolvedValue({
      id: 'sub_owned',
      status: 'canceled',
      canceled_at: 1800000000,
      ended_at: 1800000000,
    });

    await SubscriptionService.cancelSubscriptionById(
      email,
      'sub_owned',
      'immediate'
    );

    expect(db.whereRawSpy).toHaveBeenCalledWith("payload->>'id' = ?", [
      'sub_owned',
    ]);
    expect(db.deleteSpy).not.toHaveBeenCalled();
    expect(db.updateSpy).toHaveBeenCalledTimes(1);
    const updatePayload = db.updateSpy.mock.calls[0][0] as {
      active: boolean;
      payload: string;
      updated_at: Date;
    };
    expect(updatePayload.active).toBe(false);
    expect(JSON.parse(updatePayload.payload).status).toBe('canceled');
    expect(updatePayload.updated_at).toBeInstanceOf(Date);
  });

  it('does not touch the DB for period_end cancel', async () => {
    const db = buildDbMock();
    (getDatabase as Mock).mockReturnValue(db);

    await SubscriptionService.cancelSubscriptionById(
      email,
      'sub_owned',
      'period_end'
    );

    expect(db.deleteSpy).not.toHaveBeenCalled();
    expect(db.whereRawSpy).not.toHaveBeenCalled();
  });

  it('does not write the Stripe id to the logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await SubscriptionService.cancelSubscriptionById(
        email,
        'sub_owned',
        'immediate'
      );

      const leakedId = logSpy.mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('sub_owned'))
      );
      expect(leakedId).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('SubscriptionService.pauseSubscription', () => {
  let stripe: StripeMock;
  const NOW = new Date('2026-07-07T00:00:00Z');
  const monthlySub = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub_pause',
    status: 'active',
    created: Math.floor(NOW.getTime() / 1000) - 90 * 24 * 60 * 60,
    pause_collection: null,
    items: {
      data: [{ price: { recurring: { interval: 'month' } } }],
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    stripe = buildStripeMock();
    (getStripe as Mock).mockReturnValue(stripe);
    (getDatabase as Mock).mockReturnValue(buildDbMock());
    (getDefaultEmailService as Mock).mockReturnValue({});
    stripe.customers.list.mockResolvedValue({ data: [{ id: 'cus_1', email }] });
  });

  it('pauses with behavior void and a future resume date', async () => {
    stripe.subscriptions.list.mockResolvedValue({ data: [monthlySub()] });

    const result = await SubscriptionService.pauseSubscription(email, 2, NOW);

    const expectedResume = new Date(NOW.getTime());
    expectedResume.setMonth(expectedResume.getMonth() + 2);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_pause', {
      pause_collection: {
        behavior: 'void',
        resumes_at: Math.floor(expectedResume.getTime() / 1000),
      },
    });
    expect(result.resumesAt).toBe(Math.floor(expectedResume.getTime() / 1000));
    expect(result.tenureDays).toBe(90);
  });

  it('rejects annual plans', async () => {
    stripe.subscriptions.list.mockResolvedValue({
      data: [
        monthlySub({
          items: { data: [{ price: { recurring: { interval: 'year' } } }] },
        }),
      ],
    });

    await expect(
      SubscriptionService.pauseSubscription(email, 1, NOW)
    ).rejects.toBeInstanceOf(AnnualPlanNotPausableError);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('rejects subscriptions younger than 30 days', async () => {
    stripe.subscriptions.list.mockResolvedValue({
      data: [
        monthlySub({
          created: Math.floor(NOW.getTime() / 1000) - 10 * 24 * 60 * 60,
        }),
      ],
    });

    await expect(
      SubscriptionService.pauseSubscription(email, 1, NOW)
    ).rejects.toBeInstanceOf(SubscriptionTooNewToPauseError);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('rejects pause lengths outside 1-3 months', async () => {
    await expect(
      SubscriptionService.pauseSubscription(email, 4, NOW)
    ).rejects.toBeInstanceOf(InvalidPauseMonthsError);
  });

  it('throws when the user has no active subscription', async () => {
    stripe.subscriptions.list.mockResolvedValue({ data: [] });

    await expect(
      SubscriptionService.pauseSubscription(email, 1, NOW)
    ).rejects.toBeInstanceOf(SubscriptionNotOwnedError);
  });
});

describe('SubscriptionService.resumeSubscription', () => {
  let stripe: StripeMock;

  beforeEach(() => {
    vi.clearAllMocks();
    stripe = buildStripeMock();
    (getStripe as Mock).mockReturnValue(stripe);
    (getDatabase as Mock).mockReturnValue(buildDbMock());
    (getDefaultEmailService as Mock).mockReturnValue({});
    stripe.customers.list.mockResolvedValue({ data: [{ id: 'cus_1', email }] });
  });

  it('clears pause_collection on the paused subscription', async () => {
    stripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          id: 'sub_paused',
          status: 'active',
          pause_collection: { behavior: 'void', resumes_at: 1900000000 },
        },
      ],
    });

    const id = await SubscriptionService.resumeSubscription(email);

    expect(id).toBe('sub_paused');
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_paused', {
      pause_collection: '',
    });
  });

  it('throws when there is no paused subscription', async () => {
    stripe.subscriptions.list.mockResolvedValue({
      data: [{ id: 'sub_active', status: 'active', pause_collection: null }],
    });

    await expect(
      SubscriptionService.resumeSubscription(email)
    ).rejects.toBeInstanceOf(SubscriptionNotOwnedError);
  });
});
