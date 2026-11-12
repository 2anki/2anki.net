import { vi, type Mock } from 'vitest';
import express from 'express';

vi.mock('../services/SubscriptionService', () => {
  class SubscriptionNotOwnedError extends Error {
    constructor() {
      super('Subscription not found');
      this.name = 'SubscriptionNotOwnedError';
    }
  }
  return {
    __esModule: true,
    SubscriptionNotOwnedError,
    default: {
      cancelUserSubscriptions: vi.fn(),
      cancelSubscriptionById: vi.fn(),
      findRecentStripeSubscriptions: vi.fn(),
      countActiveByProductId: vi.fn().mockResolvedValue(0),
      getUserActiveSubscriptions: vi.fn().mockResolvedValue([]),
      resumeSubscription: vi.fn(),
    },
  };
});

vi.mock('../services/events/track', () => ({ track: vi.fn() }));

import SubscriptionLifecycleController from './SubscriptionLifecycleController';
import type UsersService from '../services/UsersService';
import SubscriptionService, {
  SubscriptionNotOwnedError,
} from '../services/SubscriptionService';
import { track } from '../services/events/track';

const trackMock = track as Mock;

describe('UsersController.cancelSubscription', () => {
  const buildCancelController = (dbMock?: unknown) => {
    const userService = {
      getUserById: vi
        .fn()
        .mockResolvedValue({ id: 1, email: 'sub@example.com' }),
    } as unknown as UsersService;
    const controller = new SubscriptionLifecycleController(
      userService,
      (dbMock ?? {}) as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller };
  };

  const buildResWithLocals = (owner: number | null = 1) => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return {
      json,
      status,
      locals: { owner },
    } as unknown as express.Response & {
      json: Mock;
      status: Mock;
    };
  };

  beforeEach(() => {
    (SubscriptionService.cancelUserSubscriptions as Mock).mockReset();
    trackMock.mockClear();
  });

  it('returns 422 with a recovery hint when no subscription matches the account', async () => {
    (SubscriptionService.cancelUserSubscriptions as Mock).mockResolvedValue([]);
    const { controller } = buildCancelController();
    const req = { body: { mode: 'period_end' } } as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/sign-in link.*different email/i),
      })
    );
  });

  it('returns 200 when a subscription is cancelled', async () => {
    (SubscriptionService.cancelUserSubscriptions as Mock).mockResolvedValue([
      'period_end',
    ]);
    const { controller } = buildCancelController();
    const req = { body: { mode: 'period_end' } } as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not record feedback from the cancel endpoint even if a reason is sent', async () => {
    (SubscriptionService.cancelUserSubscriptions as Mock).mockResolvedValue([
      'period_end',
    ]);
    const insert = vi.fn().mockResolvedValue([1]);
    const db = vi.fn().mockReturnValue({ insert });
    const { controller } = buildCancelController(db);
    const req = {
      body: { mode: 'period_end', reason: 'Too expensive' },
    } as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscription(req, res);

    expect(insert).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no authenticated owner', async () => {
    const { controller } = buildCancelController();
    const req = { body: { mode: 'period_end' } } as express.Request;
    const res = buildResWithLocals(null);

    await controller.cancelSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(SubscriptionService.cancelUserSubscriptions).not.toHaveBeenCalled();
  });

  it('fires subscription_cancelled once with reason and period_end cancel_type', async () => {
    (SubscriptionService.cancelUserSubscriptions as Mock).mockResolvedValue([
      'period_end',
    ]);
    const { controller } = buildCancelController();
    const req = {
      body: { mode: 'period_end', reason: "I don't use it enough" },
    } as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscription(req, res);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith('subscription_cancelled', {
      userId: 1,
      props: { reason: "I don't use it enough", cancel_type: 'period_end' },
    });
  });

  it('schedules at period end even when the client asks for immediate', async () => {
    (SubscriptionService.cancelUserSubscriptions as Mock).mockResolvedValue([
      'period_end',
      'period_end',
    ]);
    const { controller } = buildCancelController();
    const req = {
      body: { mode: 'immediate', reason: 'Too expensive' },
    } as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscription(req, res);

    expect(SubscriptionService.cancelUserSubscriptions).toHaveBeenCalledWith(
      'sub@example.com',
      'period_end'
    );
    expect(trackMock).toHaveBeenCalledWith('subscription_cancelled', {
      userId: 1,
      props: { reason: 'Too expensive', cancel_type: 'period_end' },
    });
    expect(res.json).toHaveBeenCalledWith({
      message: expect.stringMatching(/end of the current billing period/),
    });
  });

  it('records immediate when the service ended a paused-only subscription now', async () => {
    (SubscriptionService.cancelUserSubscriptions as Mock).mockResolvedValue([
      'immediate',
    ]);
    const { controller } = buildCancelController();
    const req = { body: { reason: 'Taking a break' } } as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscription(req, res);

    expect(trackMock).toHaveBeenCalledWith('subscription_cancelled', {
      userId: 1,
      props: { reason: 'Taking a break', cancel_type: 'immediate' },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: expect.stringMatching(/has been cancelled/i),
    });
    const body = res.json.mock.calls[0][0] as { message: string };
    expect(body.message).not.toMatch(/end of the current billing period/);
  });

  it('keeps period_end when one plan was scheduled and a paused one ended now', async () => {
    (SubscriptionService.cancelUserSubscriptions as Mock).mockResolvedValue([
      'immediate',
      'period_end',
    ]);
    const { controller } = buildCancelController();
    const req = { body: {} } as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscription(req, res);

    expect(trackMock).toHaveBeenCalledWith('subscription_cancelled', {
      userId: 1,
      props: { reason: null, cancel_type: 'period_end' },
    });
    expect(res.json).toHaveBeenCalledWith({
      message: expect.stringMatching(/end of the current billing period/),
    });
  });

  it('sends reason null when the body omits a reason', async () => {
    (SubscriptionService.cancelUserSubscriptions as Mock).mockResolvedValue([
      'period_end',
    ]);
    const { controller } = buildCancelController();
    const req = { body: { mode: 'period_end' } } as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscription(req, res);

    expect(trackMock).toHaveBeenCalledWith('subscription_cancelled', {
      userId: 1,
      props: { reason: null, cancel_type: 'period_end' },
    });
  });

  it('does not fire subscription_cancelled when no subscription matches', async () => {
    (SubscriptionService.cancelUserSubscriptions as Mock).mockResolvedValue([]);
    const { controller } = buildCancelController();
    const req = { body: { mode: 'period_end' } } as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscription(req, res);

    expect(trackMock).not.toHaveBeenCalled();
  });
});

describe('UsersController.getSubscriptionStatus', () => {
  const buildStatusController = () => {
    const userService = {
      getUserById: vi
        .fn()
        .mockResolvedValue({ id: 1, email: 'sub@example.com' }),
    } as unknown as UsersService;
    const controller = new SubscriptionLifecycleController(
      userService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller };
  };

  const buildResWithLocals = (owner: number | null = 1) => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return {
      json,
      status,
      locals: { owner },
    } as unknown as express.Response & {
      json: Mock;
      status: Mock;
    };
  };

  const readSummaries = (res: {
    json: Mock;
  }): Array<{ cancellation_reason: string | null }> =>
    (
      res.json.mock.calls[0][0] as {
        subscriptions: Array<{ cancellation_reason: string | null }>;
      }
    ).subscriptions;

  beforeEach(() => {
    (SubscriptionService.findRecentStripeSubscriptions as Mock).mockReset();
  });

  it('maps cancellation_details.reason onto cancellation_reason', async () => {
    (
      SubscriptionService.findRecentStripeSubscriptions as Mock
    ).mockResolvedValue([
      {
        id: 'sub_ended',
        status: 'canceled',
        created: 1_700_000_000,
        cancel_at_period_end: false,
        cancel_at: null,
        canceled_at: 1_800_000_000,
        cancellation_details: { reason: 'payment_failed' },
        items: { data: [] },
      },
    ]);
    const { controller } = buildStatusController();
    const res = buildResWithLocals();

    await controller.getSubscriptionStatus({} as express.Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(readSummaries(res)[0].cancellation_reason).toBe('payment_failed');
  });

  it('sends cancellation_reason null when Stripe has no cancellation details', async () => {
    (
      SubscriptionService.findRecentStripeSubscriptions as Mock
    ).mockResolvedValue([
      {
        id: 'sub_active',
        status: 'active',
        created: 1_700_000_000,
        cancel_at_period_end: false,
        cancel_at: null,
        canceled_at: null,
        items: { data: [] },
      },
    ]);
    const { controller } = buildStatusController();
    const res = buildResWithLocals();

    await controller.getSubscriptionStatus({} as express.Request, res);

    expect(readSummaries(res)[0].cancellation_reason).toBeNull();
  });
});

describe('UsersController.resumeSubscription', () => {
  const buildResumeController = () => {
    const userService = {
      getUserById: vi
        .fn()
        .mockResolvedValue({ id: 1, email: 'sub@example.com' }),
    } as unknown as UsersService;
    const controller = new SubscriptionLifecycleController(
      userService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller };
  };

  const buildResWithLocals = (owner: number | null = 1) => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return {
      json,
      status,
      locals: { owner },
    } as unknown as express.Response & {
      json: Mock;
      status: Mock;
    };
  };

  beforeEach(() => {
    (SubscriptionService.resumeSubscription as Mock).mockReset();
    trackMock.mockReset();
  });

  it('resumes and fires the resume event', async () => {
    (SubscriptionService.resumeSubscription as Mock).mockResolvedValue('sub_1');
    const { controller } = buildResumeController();
    const req = { body: {} } as express.Request;
    const res = buildResWithLocals();

    await controller.resumeSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(trackMock).toHaveBeenCalledWith('subscription_pause_resumed', {
      userId: 1,
    });
  });

  it('returns 422 when no paused subscription is found', async () => {
    (SubscriptionService.resumeSubscription as Mock).mockRejectedValue(
      new SubscriptionNotOwnedError()
    );
    const { controller } = buildResumeController();
    const req = { body: {} } as express.Request;
    const res = buildResWithLocals();

    await controller.resumeSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(trackMock).not.toHaveBeenCalled();
  });
});

describe('UsersController.cancelSubscriptionById', () => {
  const buildByIdController = (getUserById?: Mock) => {
    const userService = {
      getUserById:
        getUserById ??
        vi.fn().mockResolvedValue({ id: 1, email: 'sub@example.com' }),
    } as unknown as UsersService;
    const controller = new SubscriptionLifecycleController(
      userService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller };
  };

  const buildResWithLocals = (owner: number | null = 1) => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return {
      json,
      status,
      locals: { owner },
    } as unknown as express.Response & {
      json: Mock;
      status: Mock;
    };
  };

  beforeEach(() => {
    (SubscriptionService.cancelSubscriptionById as Mock).mockReset();
    trackMock.mockClear();
  });

  it('returns 401 when there is no authenticated owner', async () => {
    const { controller } = buildByIdController();
    const req = {
      params: { id: 'sub_1' },
      body: { mode: 'immediate' },
    } as unknown as express.Request;
    const res = buildResWithLocals(null);

    await controller.cancelSubscriptionById(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(SubscriptionService.cancelSubscriptionById).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the user is not found', async () => {
    const getUserById = vi.fn().mockResolvedValue(null);
    const { controller } = buildByIdController(getUserById);
    const req = {
      params: { id: 'sub_1' },
      body: { mode: 'immediate' },
    } as unknown as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscriptionById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(SubscriptionService.cancelSubscriptionById).not.toHaveBeenCalled();
  });

  it('returns 400 when the subscription id is missing', async () => {
    const { controller } = buildByIdController();
    const req = {
      params: {},
      body: { mode: 'immediate' },
    } as unknown as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscriptionById(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(SubscriptionService.cancelSubscriptionById).not.toHaveBeenCalled();
  });

  it('returns 403 and never invokes Stripe when the subscription is not owned', async () => {
    (SubscriptionService.cancelSubscriptionById as Mock).mockRejectedValue(
      new SubscriptionNotOwnedError()
    );
    const { controller } = buildByIdController();
    const req = {
      params: { id: 'sub_other' },
      body: { mode: 'immediate' },
    } as unknown as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscriptionById(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 200 when a subscription is cancelled by id', async () => {
    (SubscriptionService.cancelSubscriptionById as Mock).mockResolvedValue(
      'period_end'
    );
    const { controller } = buildByIdController();
    const req = {
      params: { id: 'sub_owned' },
      body: { mode: 'immediate' },
    } as unknown as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscriptionById(req, res);

    expect(SubscriptionService.cancelSubscriptionById).toHaveBeenCalledWith(
      'sub@example.com',
      'sub_owned'
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('fires subscription_cancelled with the reason and the mode the service applied, not the request', async () => {
    (SubscriptionService.cancelSubscriptionById as Mock).mockResolvedValue(
      'immediate'
    );
    const { controller } = buildByIdController();
    const req = {
      params: { id: 'sub_owned' },
      body: { mode: 'period_end', reason: 'I finished what I needed' },
    } as unknown as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscriptionById(req, res);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith('subscription_cancelled', {
      userId: 1,
      props: { reason: 'I finished what I needed', cancel_type: 'immediate' },
    });
  });

  it('does not fire subscription_cancelled when the subscription is not owned', async () => {
    (SubscriptionService.cancelSubscriptionById as Mock).mockRejectedValue(
      new SubscriptionNotOwnedError()
    );
    const { controller } = buildByIdController();
    const req = {
      params: { id: 'sub_other' },
      body: { mode: 'immediate' },
    } as unknown as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscriptionById(req, res);

    expect(trackMock).not.toHaveBeenCalled();
  });
});

describe('UsersController.submitCancellationFeedback', () => {
  const buildFeedbackController = (insert: Mock) => {
    const db = vi.fn().mockReturnValue({ insert });
    const controller = new SubscriptionLifecycleController(
      {} as UsersService,
      db as unknown as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, db };
  };

  const buildResWithLocals = (owner: number | null = 7) => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return {
      json,
      status,
      locals: { owner },
    } as unknown as express.Response & {
      json: Mock;
      status: Mock;
    };
  };

  it('stores the reason and comment for the owner', async () => {
    const insert = vi.fn().mockResolvedValue([1]);
    const { controller, db } = buildFeedbackController(insert);
    const req = {
      body: { reason: 'Too expensive', comment: 'too much' },
    } as express.Request;
    const res = buildResWithLocals(7);

    await controller.submitCancellationFeedback(req, res);

    expect(db).toHaveBeenCalledWith('cancellation_feedback');
    expect(insert).toHaveBeenCalledWith({
      owner: 7,
      reason: 'Too expensive',
      comment: 'too much',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects feedback without a reason and never touches the database', async () => {
    const insert = vi.fn();
    const { controller } = buildFeedbackController(insert);
    const req = { body: { comment: 'no reason given' } } as express.Request;
    const res = buildResWithLocals(7);

    await controller.submitCancellationFeedback(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(insert).not.toHaveBeenCalled();
  });
});
