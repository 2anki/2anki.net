import express from 'express';

jest.mock('../services/SubscriptionService', () => {
  class SubscriptionNotOwnedError extends Error {
    constructor() {
      super('Subscription not found');
      this.name = 'SubscriptionNotOwnedError';
    }
  }
  class AnnualPlanNotPausableError extends Error {
    constructor() {
      super('Annual plans cannot be paused');
      this.name = 'AnnualPlanNotPausableError';
    }
  }
  class SubscriptionTooNewToPauseError extends Error {
    constructor() {
      super('Subscription is too new to pause');
      this.name = 'SubscriptionTooNewToPauseError';
    }
  }
  class InvalidPauseMonthsError extends Error {
    constructor() {
      super('Pause length must be 1, 2, or 3 months');
      this.name = 'InvalidPauseMonthsError';
    }
  }
  return {
    __esModule: true,
    SubscriptionNotOwnedError,
    AnnualPlanNotPausableError,
    SubscriptionTooNewToPauseError,
    InvalidPauseMonthsError,
    default: {
      cancelUserSubscriptions: jest.fn(),
      cancelSubscriptionById: jest.fn(),
      findRecentStripeSubscriptions: jest.fn(),
      countActiveByProductId: jest.fn().mockResolvedValue(0),
      getUserActiveSubscriptions: jest.fn().mockResolvedValue([]),
      pauseSubscription: jest.fn(),
      resumeSubscription: jest.fn(),
    },
  };
});

jest.mock('../services/events/track', () => ({ track: jest.fn() }));

import SubscriptionLifecycleController from './SubscriptionLifecycleController';
import type UsersService from '../services/UsersService';
import SubscriptionService, {
  SubscriptionNotOwnedError,
  AnnualPlanNotPausableError,
} from '../services/SubscriptionService';
import { track } from '../services/events/track';

const trackMock = track as jest.Mock;

describe('UsersController.cancelSubscription', () => {
  const buildCancelController = (dbMock?: unknown) => {
    const userService = {
      getUserById: jest
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
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return {
      json,
      status,
      locals: { owner },
    } as unknown as express.Response & {
      json: jest.Mock;
      status: jest.Mock;
    };
  };

  beforeEach(() => {
    (SubscriptionService.cancelUserSubscriptions as jest.Mock).mockReset();
    trackMock.mockClear();
  });

  it('returns 422 with a recovery hint when no subscription matches the account', async () => {
    (
      SubscriptionService.cancelUserSubscriptions as jest.Mock
    ).mockResolvedValue(0);
    const { controller } = buildCancelController();
    const req = { body: { mode: 'period_end' } } as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/different email/i),
      })
    );
  });

  it('returns 200 when a subscription is cancelled', async () => {
    (
      SubscriptionService.cancelUserSubscriptions as jest.Mock
    ).mockResolvedValue(1);
    const { controller } = buildCancelController();
    const req = { body: { mode: 'period_end' } } as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not record feedback from the cancel endpoint even if a reason is sent', async () => {
    (
      SubscriptionService.cancelUserSubscriptions as jest.Mock
    ).mockResolvedValue(1);
    const insert = jest.fn().mockResolvedValue([1]);
    const db = jest.fn().mockReturnValue({ insert });
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
    (
      SubscriptionService.cancelUserSubscriptions as jest.Mock
    ).mockResolvedValue(1);
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

  it('records cancel_type immediate when the mode is immediate', async () => {
    (
      SubscriptionService.cancelUserSubscriptions as jest.Mock
    ).mockResolvedValue(2);
    const { controller } = buildCancelController();
    const req = {
      body: { mode: 'immediate', reason: 'Too expensive' },
    } as express.Request;
    const res = buildResWithLocals();

    await controller.cancelSubscription(req, res);

    expect(trackMock).toHaveBeenCalledWith('subscription_cancelled', {
      userId: 1,
      props: { reason: 'Too expensive', cancel_type: 'immediate' },
    });
  });

  it('sends reason null when the body omits a reason', async () => {
    (
      SubscriptionService.cancelUserSubscriptions as jest.Mock
    ).mockResolvedValue(1);
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
    (
      SubscriptionService.cancelUserSubscriptions as jest.Mock
    ).mockResolvedValue(0);
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
      getUserById: jest
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
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return {
      json,
      status,
      locals: { owner },
    } as unknown as express.Response & {
      json: jest.Mock;
      status: jest.Mock;
    };
  };

  const readSummaries = (res: {
    json: jest.Mock;
  }): Array<{ cancellation_reason: string | null }> =>
    (
      res.json.mock.calls[0][0] as {
        subscriptions: Array<{ cancellation_reason: string | null }>;
      }
    ).subscriptions;

  beforeEach(() => {
    (
      SubscriptionService.findRecentStripeSubscriptions as jest.Mock
    ).mockReset();
  });

  it('maps cancellation_details.reason onto cancellation_reason', async () => {
    (
      SubscriptionService.findRecentStripeSubscriptions as jest.Mock
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
      SubscriptionService.findRecentStripeSubscriptions as jest.Mock
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

describe('UsersController.pauseSubscription', () => {
  const buildPauseController = () => {
    const userService = {
      getUserById: jest
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
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return {
      json,
      status,
      locals: { owner },
    } as unknown as express.Response & {
      json: jest.Mock;
      status: jest.Mock;
    };
  };

  beforeEach(() => {
    (SubscriptionService.pauseSubscription as jest.Mock).mockReset();
  });

  it('pauses and returns the resume date', async () => {
    (SubscriptionService.pauseSubscription as jest.Mock).mockResolvedValue({
      subscriptionId: 'sub_1',
      resumesAt: 1900000000,
      tenureDays: 90,
    });
    const { controller } = buildPauseController();
    const req = { body: { months: 2 } } as express.Request;
    const res = buildResWithLocals();

    await controller.pauseSubscription(req, res);

    expect(SubscriptionService.pauseSubscription).toHaveBeenCalledWith(
      'sub@example.com',
      2
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ resumes_at: 1900000000 })
    );
  });

  it('returns 400 for an invalid pause length', async () => {
    const { controller } = buildPauseController();
    const req = { body: { months: 5 } } as express.Request;
    const res = buildResWithLocals();

    await controller.pauseSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(SubscriptionService.pauseSubscription).not.toHaveBeenCalled();
  });

  it('maps an annual plan rejection to 422', async () => {
    (SubscriptionService.pauseSubscription as jest.Mock).mockRejectedValue(
      new AnnualPlanNotPausableError()
    );
    const { controller } = buildPauseController();
    const req = { body: { months: 1 } } as express.Request;
    const res = buildResWithLocals();

    await controller.pauseSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('returns 401 without an authenticated owner', async () => {
    const { controller } = buildPauseController();
    const req = { body: { months: 1 } } as express.Request;
    const res = buildResWithLocals(null);

    await controller.pauseSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('UsersController.resumeSubscription', () => {
  const buildResumeController = () => {
    const userService = {
      getUserById: jest
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
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return {
      json,
      status,
      locals: { owner },
    } as unknown as express.Response & {
      json: jest.Mock;
      status: jest.Mock;
    };
  };

  beforeEach(() => {
    (SubscriptionService.resumeSubscription as jest.Mock).mockReset();
    trackMock.mockReset();
  });

  it('resumes and fires the resume event', async () => {
    (SubscriptionService.resumeSubscription as jest.Mock).mockResolvedValue(
      'sub_1'
    );
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
    (SubscriptionService.resumeSubscription as jest.Mock).mockRejectedValue(
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
  const buildByIdController = (getUserById?: jest.Mock) => {
    const userService = {
      getUserById:
        getUserById ??
        jest.fn().mockResolvedValue({ id: 1, email: 'sub@example.com' }),
    } as unknown as UsersService;
    const controller = new SubscriptionLifecycleController(
      userService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller };
  };

  const buildResWithLocals = (owner: number | null = 1) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return {
      json,
      status,
      locals: { owner },
    } as unknown as express.Response & {
      json: jest.Mock;
      status: jest.Mock;
    };
  };

  beforeEach(() => {
    (SubscriptionService.cancelSubscriptionById as jest.Mock).mockReset();
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
    const getUserById = jest.fn().mockResolvedValue(null);
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
    (SubscriptionService.cancelSubscriptionById as jest.Mock).mockRejectedValue(
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
    (SubscriptionService.cancelSubscriptionById as jest.Mock).mockResolvedValue(
      undefined
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
      'sub_owned',
      'immediate'
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('fires subscription_cancelled with reason and cancel_type from the request', async () => {
    (SubscriptionService.cancelSubscriptionById as jest.Mock).mockResolvedValue(
      undefined
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
      props: { reason: 'I finished what I needed', cancel_type: 'period_end' },
    });
  });

  it('does not fire subscription_cancelled when the subscription is not owned', async () => {
    (SubscriptionService.cancelSubscriptionById as jest.Mock).mockRejectedValue(
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
  const buildFeedbackController = (insert: jest.Mock) => {
    const db = jest.fn().mockReturnValue({ insert });
    const controller = new SubscriptionLifecycleController(
      {} as UsersService,
      db as unknown as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, db };
  };

  const buildResWithLocals = (owner: number | null = 7) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return {
      json,
      status,
      locals: { owner },
    } as unknown as express.Response & {
      json: jest.Mock;
      status: jest.Mock;
    };
  };

  it('stores the reason and comment for the owner', async () => {
    const insert = jest.fn().mockResolvedValue([1]);
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
    const insert = jest.fn();
    const { controller } = buildFeedbackController(insert);
    const req = { body: { comment: 'no reason given' } } as express.Request;
    const res = buildResWithLocals(7);

    await controller.submitCancellationFeedback(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(insert).not.toHaveBeenCalled();
  });
});
