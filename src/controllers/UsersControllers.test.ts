import express from 'express';

jest.mock('../lib/integrations/stripe', () => ({
  getStripe: jest.fn().mockReturnValue({
    customers: { retrieve: jest.fn() },
    subscriptions: {
      retrieve: jest.fn(),
      cancel: jest.fn(),
      update: jest.fn(),
    },
  }),
  updateStoreSubscription: jest.fn().mockResolvedValue(undefined),
}));

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

jest.mock('../lib/misc/hashToken', () => ({
  __esModule: true,
  default: jest.fn().mockReturnValue('hashed-token'),
}));

jest.mock('../services/events/track', () => ({ track: jest.fn() }));

const mockGetById = jest.fn().mockResolvedValue({ patreon: false });

jest.mock('../data_layer/UsersRepository', () => {
  return jest.fn().mockImplementation(() => ({
    setSignupCountryIfMissing: jest.fn().mockResolvedValue(undefined),
    getSignupCountry: jest.fn().mockResolvedValue(null),
    getById: mockGetById,
    getCardUsage: jest.fn().mockResolvedValue({ cards_used: 0 }),
    getPrintUsage: jest
      .fn()
      .mockResolvedValue({ prints_used: 0, month_started_at: null }),
    updateName: jest.fn().mockResolvedValue(undefined),
  }));
});

const mockCountPaidPassesSince = jest
  .fn()
  .mockResolvedValue({ dayPasses: 0, weekPasses: 0 });

jest.mock('../data_layer/UserPassRepository', () => {
  const actual = jest.requireActual('../data_layer/UserPassRepository');
  return {
    ...actual,
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      countPaidPassesSince: mockCountPaidPassesSince,
      findActive: jest.fn().mockResolvedValue(null),
    })),
  };
});

import UsersController from './UsersControllers';
import UsersService, {
  MagicLinkRateLimitError,
  MagicLinkSuppressedError,
} from '../services/UsersService';
import AuthenticationService from '../services/AuthenticationService';
import SubscriptionService, {
  SubscriptionNotOwnedError,
  AnnualPlanNotPausableError,
} from '../services/SubscriptionService';
import OauthIdentitiesRepository from '../data_layer/OauthIdentitiesRepository';
import NotionRepository from '../data_layer/NotionRespository';
import { SESSION_MAX_AGE_MS } from '../shared/session';
import { track } from '../services/events/track';

const trackMock = track as jest.Mock;

const SAMPLE_PW = '12345678';

const buildRes = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const cookie = jest.fn();
  return { json, status, cookie } as unknown as express.Response & {
    json: jest.Mock;
    status: jest.Mock;
    cookie: jest.Mock;
  };
};

const buildController = (overrides?: {
  getUserFrom?: jest.Mock;
  register?: jest.Mock;
  getHashPassword?: jest.Mock;
  newJWTToken?: jest.Mock;
  persistToken?: jest.Mock;
  updateLastLoginAt?: jest.Mock;
}) => {
  const mockUser = { id: 1, email: 'test@example.com' };
  const userService = {
    getUserFrom:
      overrides?.getUserFrom ??
      jest.fn().mockResolvedValueOnce(null).mockResolvedValue(mockUser),
    register: overrides?.register ?? jest.fn().mockResolvedValue([{ id: 1 }]),
    updateLastLoginAt:
      overrides?.updateLastLoginAt ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as UsersService;
  const authService = {
    getHashPassword:
      overrides?.getHashPassword ?? jest.fn().mockReturnValue('hashed'),
    newJWTToken:
      overrides?.newJWTToken ?? jest.fn().mockResolvedValue('jwt-tok'),
    persistToken:
      overrides?.persistToken ?? jest.fn().mockResolvedValue(undefined),
    isValidLogin: jest.fn().mockReturnValue(true),
  } as unknown as AuthenticationService;
  const controller = new UsersController(
    userService,
    authService,
    {} as ReturnType<typeof import('../data_layer').getDatabase>
  );
  return { controller, userService, authService };
};

describe('UsersController.register', () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  it('emits account_created keyed to the new user id and the request anonymous id on success', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 1 }]);
    const { controller } = buildController({ register });
    const req = {
      body: {
        email: 'jane.doe@example.com',
        password: SAMPLE_PW,
        source: '/notion-to-anki',
      },
      query: {},
      cookies: { anon_id: 'anon-abc-123' },
    } as unknown as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(trackMock).toHaveBeenCalledWith('account_created', {
      userId: 1,
      anonymousId: 'anon-abc-123',
      props: { signup_origin: '/notion-to-anki' },
    });
  });

  it('emits signup_origin and signup_referrer from the first_touch cookie', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 1 }]);
    const { controller } = buildController({ register });
    const req = {
      body: { email: 'jane.doe@example.com', password: SAMPLE_PW },
      query: {},
      cookies: {
        anon_id: 'anon-abc-123',
        first_touch: JSON.stringify({
          landingPath: '/pdf-to-anki',
          referrer: 'chatgpt.com',
        }),
      },
    } as unknown as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(trackMock).toHaveBeenCalledWith('account_created', {
      userId: 1,
      anonymousId: 'anon-abc-123',
      props: {
        signup_origin: '/pdf-to-anki',
        signup_referrer: 'chatgpt.com',
      },
    });
    expect(register).toHaveBeenCalledWith(
      '',
      'hashed',
      'jane.doe@example.com',
      '/pdf-to-anki'
    );
  });

  it('prefers the first_touch cookie over the legacy source field', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 1 }]);
    const { controller } = buildController({ register });
    const req = {
      body: {
        email: 'jane.doe@example.com',
        password: SAMPLE_PW,
        source: '/notion-to-anki',
      },
      query: {},
      cookies: {
        first_touch: JSON.stringify({ landingPath: '/markdown-to-anki' }),
      },
    } as unknown as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(trackMock).toHaveBeenCalledWith('account_created', {
      userId: 1,
      anonymousId: null,
      props: { signup_origin: '/markdown-to-anki' },
    });
  });

  it('emits account_created with a null anonymous id when no anon_id cookie is present', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 1 }]);
    const { controller } = buildController({ register });
    const req = {
      body: { email: 'jane.doe@example.com', password: SAMPLE_PW },
      query: {},
      cookies: {},
    } as unknown as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(trackMock).toHaveBeenCalledWith(
      'account_created',
      expect.objectContaining({ userId: 1, anonymousId: null })
    );
  });

  it('does not emit account_created when the email is already registered', async () => {
    const getUserFrom = jest
      .fn()
      .mockResolvedValue({ id: 1, email: 'taken@example.com' });
    const register = jest.fn();
    const { controller } = buildController({ getUserFrom, register });
    const req = {
      body: { email: 'taken@example.com', password: SAMPLE_PW },
      cookies: { anon_id: 'anon-abc-123' },
    } as unknown as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(trackMock).not.toHaveBeenCalled();
  });

  it('rejects requests missing both email and password with 400', async () => {
    const { controller } = buildController();
    const req = { body: {} } as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/email and password/i),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests missing only the password with 400', async () => {
    const { controller } = buildController();
    const req = { body: { email: 'a@b.com' } } as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('auto-logs in the user after registration and sets a JWT cookie', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 1 }]);
    const newJWTToken = jest.fn().mockResolvedValue('jwt-reg-tok');
    const persistToken = jest.fn().mockResolvedValue(undefined);
    const updateLastLoginAt = jest.fn().mockResolvedValue(undefined);
    const { controller } = buildController({
      register,
      newJWTToken,
      persistToken,
      updateLastLoginAt,
    });
    const req = {
      body: { email: 'jane.doe@example.com', password: SAMPLE_PW },
      query: {},
    } as unknown as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(register).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'jwt-reg-tok',
      expect.objectContaining({
        maxAge: SESSION_MAX_AGE_MS,
        httpOnly: false,
        sameSite: 'lax',
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'jwt-reg-tok' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('still accepts a name when older clients send one', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 1 }]);
    const { controller } = buildController({ register });
    const req = {
      body: {
        email: 'alex@example.com',
        password: SAMPLE_PW,
        name: 'Alex',
      },
      query: {},
    } as unknown as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(register).toHaveBeenCalledWith(
      'Alex',
      'hashed',
      'alex@example.com',
      null
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('persists signup_origin when source matches an allowed landing path', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 1 }]);
    const { controller } = buildController({ register });
    const req = {
      body: {
        email: 'al@example.com',
        password: SAMPLE_PW,
        source: '/notion-to-anki',
      },
      query: {},
    } as unknown as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      'hashed',
      'al@example.com',
      '/notion-to-anki'
    );
  });

  it('drops the signup_origin to null when source fails the allowlist regex', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 1 }]);
    const { controller } = buildController({ register });
    const req = {
      body: {
        email: 'al@example.com',
        password: SAMPLE_PW,
        source: '<script>alert(1)</script>',
      },
      query: {},
    } as unknown as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      'hashed',
      'al@example.com',
      null
    );
  });

  it('returns 400 when the email is already registered', async () => {
    const getUserFrom = jest
      .fn()
      .mockResolvedValue({ id: 1, email: 'taken@example.com' });
    const register = jest.fn();
    const { controller } = buildController({ getUserFrom, register });
    const req = {
      body: { email: 'taken@example.com', password: SAMPLE_PW },
    } as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(register).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message:
        'An account with this email already exists. Try logging in instead.',
    });
  });
});

describe('UsersController.verifyEmail', () => {
  const buildVerifyEmailController = (overrides?: {
    verifyMagicToken?: jest.Mock;
    markEmailVerified?: jest.Mock;
    authGetUserFrom?: jest.Mock;
  }) => {
    const userService = {
      verifyMagicToken:
        overrides?.verifyMagicToken ?? jest.fn().mockResolvedValue(null),
      markEmailVerified:
        overrides?.markEmailVerified ?? jest.fn().mockResolvedValue(1),
    } as unknown as UsersService;
    const authService = {
      getUserFrom:
        overrides?.authGetUserFrom ?? jest.fn().mockResolvedValue(null),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, userService };
  };

  const buildVerifyEmailRes = () => {
    const redirect = jest.fn();
    return { redirect } as unknown as express.Response & {
      redirect: jest.Mock;
    };
  };

  it('redirects to /login?verified=1 when the verify_email token is valid and user is unauthenticated', async () => {
    const verifyMagicToken = jest
      .fn()
      .mockResolvedValue({ userId: 7, purpose: 'verify_email' });
    const markEmailVerified = jest.fn().mockResolvedValue(1);
    const { controller } = buildVerifyEmailController({
      verifyMagicToken,
      markEmailVerified,
    });
    const req = {
      params: { token: 'valid-verify-tok' },
      cookies: {},
    } as unknown as express.Request;
    const res = buildVerifyEmailRes();
    const next = jest.fn();

    await controller.verifyEmail(req, res, next);

    expect(markEmailVerified).toHaveBeenCalledWith('7');
    expect(res.redirect).toHaveBeenCalledWith('/login?verified=1');
  });

  it('redirects to /account?verified=1 when the token is valid and user is authenticated', async () => {
    const verifyMagicToken = jest
      .fn()
      .mockResolvedValue({ userId: 7, purpose: 'verify_email' });
    const markEmailVerified = jest.fn().mockResolvedValue(1);
    const authGetUserFrom = jest.fn().mockResolvedValue({ id: 7 });
    const { controller } = buildVerifyEmailController({
      verifyMagicToken,
      markEmailVerified,
      authGetUserFrom,
    });
    const req = {
      params: { token: 'valid-verify-tok' },
      cookies: { token: 'session' },
    } as unknown as express.Request;
    const res = buildVerifyEmailRes();
    const next = jest.fn();

    await controller.verifyEmail(req, res, next);

    expect(markEmailVerified).toHaveBeenCalledWith('7');
    expect(res.redirect).toHaveBeenCalledWith('/account?verified=1');
  });

  it('redirects to /login?verify_error=expired when token is invalid and user is unauthenticated', async () => {
    const { controller } = buildVerifyEmailController();
    const req = {
      params: { token: 'bad-tok' },
      cookies: {},
    } as unknown as express.Request;
    const res = buildVerifyEmailRes();
    const next = jest.fn();

    await controller.verifyEmail(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/login?verify_error=expired');
  });

  it('redirects to /account?verify_error=expired when token is invalid and user is authenticated', async () => {
    const authGetUserFrom = jest.fn().mockResolvedValue({ id: 7 });
    const { controller } = buildVerifyEmailController({ authGetUserFrom });
    const req = {
      params: { token: 'bad-tok' },
      cookies: { token: 'session' },
    } as unknown as express.Request;
    const res = buildVerifyEmailRes();
    const next = jest.fn();

    await controller.verifyEmail(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/account?verify_error=expired');
  });

  it('redirects to /login?verify_error=expired for non-verify_email purpose tokens when unauthenticated', async () => {
    const verifyMagicToken = jest
      .fn()
      .mockResolvedValue({ userId: 7, purpose: 'login' });
    const { controller } = buildVerifyEmailController({ verifyMagicToken });
    const req = {
      params: { token: 'login-tok' },
      cookies: {},
    } as unknown as express.Request;
    const res = buildVerifyEmailRes();
    const next = jest.fn();

    await controller.verifyEmail(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/login?verify_error=expired');
  });

  it('logs the error and forwards it to next() when verification throws', async () => {
    const dbError = new Error('Database connection failed');
    const verifyMagicToken = jest.fn().mockRejectedValue(dbError);
    const { controller } = buildVerifyEmailController({ verifyMagicToken });
    const req = {
      params: { token: 'valid-tok' },
      cookies: {},
    } as unknown as express.Request;
    const res = buildVerifyEmailRes();
    const next = jest.fn();
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    try {
      await controller.verifyEmail(req, res, next);

      expect(consoleError).toHaveBeenCalledWith(
        'Email verification failed:',
        dbError
      );
      expect(next).toHaveBeenCalledWith(dbError);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('UsersController.requestMagicLink', () => {
  const buildMagicController = (overrides?: {
    requestMagicLink?: jest.Mock;
  }) => {
    const userService = {
      requestMagicLink:
        overrides?.requestMagicLink ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {} as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, userService };
  };

  it('returns 200 for a valid email and purpose', async () => {
    const { controller } = buildMagicController();
    const req = {
      body: { email: 'al@example.com', purpose: 'login' },
    } as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.requestMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'ok' });
  });

  it('defaults purpose to login when not provided', async () => {
    const requestMagicLink = jest.fn().mockResolvedValue(undefined);
    const { controller } = buildMagicController({ requestMagicLink });
    const req = {
      body: { email: 'al@example.com' },
    } as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.requestMagicLink(req, res, next);

    expect(requestMagicLink).toHaveBeenCalledWith('al@example.com', 'login');
  });

  it('returns 400 when email is missing', async () => {
    const { controller } = buildMagicController();
    const req = { body: { purpose: 'login' } } as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.requestMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for an invalid purpose', async () => {
    const { controller } = buildMagicController();
    const req = {
      body: { email: 'al@example.com', purpose: 'evil' },
    } as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.requestMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid purpose' });
  });

  it('returns 200 even when rate limited to prevent email enumeration', async () => {
    const requestMagicLink = jest
      .fn()
      .mockRejectedValue(new MagicLinkRateLimitError());
    const { controller } = buildMagicController({ requestMagicLink });
    const req = {
      body: { email: 'al@example.com', purpose: 'login' },
    } as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.requestMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 200 with suppressed flag when the address is on the suppression list', async () => {
    const requestMagicLink = jest
      .fn()
      .mockRejectedValue(new MagicLinkSuppressedError());
    const { controller } = buildMagicController({ requestMagicLink });
    const req = {
      body: { email: 'blocked@example.com', purpose: 'login' },
    } as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.requestMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      message: 'suppressed',
      suppressed: true,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards infrastructure errors to next() so ErrorHandler can surface them', async () => {
    const sendgridError = new Error('SendGrid down');
    const requestMagicLink = jest.fn().mockRejectedValue(sendgridError);
    const { controller } = buildMagicController({ requestMagicLink });
    const req = {
      body: { email: 'al@example.com', purpose: 'login' },
    } as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.requestMagicLink(req, res, next);

    expect(next).toHaveBeenCalledWith(sendgridError);
    expect(res.status).not.toHaveBeenCalledWith(200);
  });
});

describe('UsersController.verifyMagicLink', () => {
  const buildVerifyController = (overrides?: {
    verifyMagicToken?: jest.Mock;
    getUserById?: jest.Mock;
    newJWTToken?: jest.Mock;
    persistToken?: jest.Mock;
    updateLastLoginAt?: jest.Mock;
    markEmailVerified?: jest.Mock;
  }) => {
    const userService = {
      verifyMagicToken:
        overrides?.verifyMagicToken ?? jest.fn().mockResolvedValue(null),
      getUserById:
        overrides?.getUserById ??
        jest.fn().mockResolvedValue({ id: 1, email: 'al@example.com' }),
      updateLastLoginAt:
        overrides?.updateLastLoginAt ?? jest.fn().mockResolvedValue(undefined),
      markEmailVerified:
        overrides?.markEmailVerified ?? jest.fn().mockResolvedValue(1),
    } as unknown as UsersService;
    const authService = {
      newJWTToken:
        overrides?.newJWTToken ?? jest.fn().mockResolvedValue('jwt-token-abc'),
      persistToken:
        overrides?.persistToken ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, userService, authService };
  };

  const buildVerifyRes = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const cookie = jest.fn();
    return { json, status, cookie } as unknown as express.Response & {
      json: jest.Mock;
      status: jest.Mock;
      cookie: jest.Mock;
    };
  };

  it('returns 400 for an invalid token', async () => {
    const { controller } = buildVerifyController();
    const req = {
      params: { token: 'bad-token' },
    } as unknown as express.Request;
    const res = buildVerifyRes();
    const next = jest.fn();

    await controller.verifyMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'This link is invalid or has expired.',
    });
  });

  it('sets a JWT cookie and returns the token for a login purpose', async () => {
    const verifyMagicToken = jest
      .fn()
      .mockResolvedValue({ userId: 5, purpose: 'login' });
    const newJWTToken = jest.fn().mockResolvedValue('jwt-login-tok');
    const persistToken = jest.fn().mockResolvedValue(undefined);
    const updateLastLoginAt = jest.fn().mockResolvedValue(undefined);
    const getUserById = jest
      .fn()
      .mockResolvedValue({ id: 5, email: 'al@example.com' });
    const { controller } = buildVerifyController({
      verifyMagicToken,
      newJWTToken,
      persistToken,
      updateLastLoginAt,
      getUserById,
    });
    const req = {
      params: { token: 'valid-tok' },
    } as unknown as express.Request;
    const res = buildVerifyRes();
    const next = jest.fn();

    await controller.verifyMagicLink(req, res, next);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'jwt-login-tok',
      expect.objectContaining({
        maxAge: SESSION_MAX_AGE_MS,
        httpOnly: false,
        sameSite: 'lax',
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ token: 'jwt-login-tok' });
    expect(persistToken).toHaveBeenCalledWith('jwt-login-tok', '5');
    expect(updateLastLoginAt).toHaveBeenCalledWith('5');
  });

  it('returns purpose and reset_token for a password_reset token', async () => {
    const verifyMagicToken = jest
      .fn()
      .mockResolvedValue({ userId: 8, purpose: 'password_reset' });
    const getUserById = jest
      .fn()
      .mockResolvedValue({ id: 8, email: 'reset@example.com' });
    const updateResetToken = jest.fn().mockResolvedValue(undefined);
    const userService = {
      verifyMagicToken,
      getUserById,
      updateResetToken,
      updateLastLoginAt: jest.fn().mockResolvedValue(undefined),
      markEmailVerified: jest.fn().mockResolvedValue(1),
    } as unknown as UsersService;
    const authService = {
      newJWTToken: jest.fn().mockResolvedValue('jwt-tok'),
      persistToken: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = {
      params: { token: 'reset-tok' },
    } as unknown as express.Request;
    const res = buildVerifyRes();
    const next = jest.fn();

    await controller.verifyMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.purpose).toBe('password_reset');
    expect(typeof jsonCall.reset_token).toBe('string');
    expect(jsonCall.reset_token.length).toBeGreaterThan(0);
    expect(updateResetToken).toHaveBeenCalledWith('8', jsonCall.reset_token);
  });

  it('marks email verified after a successful login magic link', async () => {
    const verifyMagicToken = jest
      .fn()
      .mockResolvedValue({ userId: 5, purpose: 'login' });
    const getUserById = jest
      .fn()
      .mockResolvedValue({ id: 5, email: 'al@example.com' });
    const markEmailVerified = jest.fn().mockResolvedValue(1);
    const { controller } = buildVerifyController({
      verifyMagicToken,
      getUserById,
      markEmailVerified,
    });
    const req = {
      params: { token: 'valid-tok' },
    } as unknown as express.Request;
    const res = buildVerifyRes();
    const next = jest.fn();

    await controller.verifyMagicLink(req, res, next);

    expect(markEmailVerified).toHaveBeenCalledWith('5');
  });

  it('marks email verified after a successful password_reset magic link', async () => {
    const verifyMagicToken = jest
      .fn()
      .mockResolvedValue({ userId: 8, purpose: 'password_reset' });
    const getUserById = jest
      .fn()
      .mockResolvedValue({ id: 8, email: 'reset@example.com' });
    const markEmailVerified = jest.fn().mockResolvedValue(1);
    const updateResetToken = jest.fn().mockResolvedValue(undefined);
    const userService = {
      verifyMagicToken,
      getUserById,
      updateResetToken,
      updateLastLoginAt: jest.fn().mockResolvedValue(undefined),
      markEmailVerified,
    } as unknown as UsersService;
    const authService = {
      newJWTToken: jest.fn().mockResolvedValue('jwt-tok'),
      persistToken: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = {
      params: { token: 'reset-tok' },
    } as unknown as express.Request;
    const res = buildVerifyRes();
    const next = jest.fn();

    await controller.verifyMagicLink(req, res, next);

    expect(markEmailVerified).toHaveBeenCalledWith('8');
  });
});

describe('UsersController.loginWithGoogle', () => {
  const buildGoogleController = (overrides?: {
    getUserFrom?: jest.Mock;
    register?: jest.Mock;
    markEmailVerified?: jest.Mock;
    newJWTToken?: jest.Mock;
    persistToken?: jest.Mock;
    updateLastLoginAt?: jest.Mock;
    loginWithGoogle?: jest.Mock;
  }) => {
    const mockUser = { id: 7, email: 'g@example.com' };
    const userService = {
      getUserFrom:
        overrides?.getUserFrom ??
        jest.fn().mockResolvedValueOnce(null).mockResolvedValue(mockUser),
      register: overrides?.register ?? jest.fn().mockResolvedValue([{ id: 7 }]),
      markEmailVerified:
        overrides?.markEmailVerified ?? jest.fn().mockResolvedValue(1),
      updateLastLoginAt:
        overrides?.updateLastLoginAt ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithGoogle:
        overrides?.loginWithGoogle ??
        jest.fn().mockResolvedValue({
          ok: true,
          email: 'g@example.com',
          name: 'Google User',
        }),
      getHashPassword: jest.fn().mockReturnValue('hashed'),
      newJWTToken:
        overrides?.newJWTToken ?? jest.fn().mockResolvedValue('google-jwt'),
      persistToken:
        overrides?.persistToken ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, userService, authService };
  };

  const buildGoogleRes = () => {
    const redirect = jest.fn();
    const cookie = jest.fn();
    const status = jest.fn().mockReturnThis();
    return { redirect, cookie, status } as unknown as express.Response & {
      redirect: jest.Mock;
      cookie: jest.Mock;
      status: jest.Mock;
    };
  };

  it("registers new Google users with signup_origin set to 'google'", async () => {
    const register = jest.fn().mockResolvedValue([{ id: 7 }]);
    const { controller } = buildGoogleController({ register });
    const req = {
      query: { code: 'gauth-code' },
      cookies: {},
      headers: {},
    } as unknown as express.Request;
    const res = buildGoogleRes();

    await controller.loginWithGoogle(req, res);

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'g@example.com',
      'google'
    );
  });

  it('does not call register for an existing Google user', async () => {
    const existingUser = { id: 9, email: 'existing@example.com' };
    const getUserFrom = jest.fn().mockResolvedValue(existingUser);
    const register = jest.fn();
    const { controller } = buildGoogleController({ getUserFrom, register });
    const req = {
      query: { code: 'gauth-code' },
      cookies: {},
      headers: {},
    } as unknown as express.Request;
    const res = buildGoogleRes();

    await controller.loginWithGoogle(req, res);

    expect(register).not.toHaveBeenCalled();
  });

  it('redirects with error=google_signin_failed when the token exchange fails', async () => {
    const loginWithGoogle = jest.fn().mockResolvedValue({
      ok: false,
      reason: 'token_exchange_failed',
      message: 'Error: invalid_grant',
    });
    const { controller } = buildGoogleController({ loginWithGoogle });
    const req = {
      query: { code: 'gauth-code' },
      cookies: {},
      headers: {},
    } as unknown as express.Request;
    const res = buildGoogleRes();

    await controller.loginWithGoogle(req, res);

    expect(res.redirect).toHaveBeenCalledWith(
      '/login?error=google_signin_failed'
    );
  });

  it('redirects with error=google_signin_failed when the OAuth code is missing', async () => {
    const { controller } = buildGoogleController();
    const req = {
      query: {},
      cookies: {},
      headers: {},
    } as unknown as express.Request;
    const res = buildGoogleRes();

    await controller.loginWithGoogle(req, res);

    expect(res.redirect).toHaveBeenCalledWith(
      '/login?error=google_signin_failed'
    );
  });
});

jest.mock('../data_layer/OauthIdentitiesRepository');
jest.mock('../data_layer/NotionRespository');

describe('UsersController.loginWithMicrosoft', () => {
  const MockedOauthIdentitiesRepo =
    OauthIdentitiesRepository as jest.MockedClass<
      typeof OauthIdentitiesRepository
    >;

  beforeEach(() => {
    MockedOauthIdentitiesRepo.mockClear();
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = jest
      .fn()
      .mockResolvedValue(null);
    MockedOauthIdentitiesRepo.prototype.link = jest
      .fn()
      .mockResolvedValue(undefined);
  });

  const buildMicrosoftController = (overrides?: {
    getUserFrom?: jest.Mock;
    getUserById?: jest.Mock;
    register?: jest.Mock;
    markEmailVerified?: jest.Mock;
    newJWTToken?: jest.Mock;
    persistToken?: jest.Mock;
    updateLastLoginAt?: jest.Mock;
    loginWithMicrosoft?: jest.Mock;
  }) => {
    const mockUser = { id: 11, email: 'm@example.com' };
    const userService = {
      getUserFrom:
        overrides?.getUserFrom ??
        jest.fn().mockResolvedValueOnce(null).mockResolvedValue(mockUser),
      getUserById:
        overrides?.getUserById ?? jest.fn().mockResolvedValue(mockUser),
      register:
        overrides?.register ?? jest.fn().mockResolvedValue([{ id: 11 }]),
      markEmailVerified:
        overrides?.markEmailVerified ?? jest.fn().mockResolvedValue(1),
      updateLastLoginAt:
        overrides?.updateLastLoginAt ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithMicrosoft:
        overrides?.loginWithMicrosoft ??
        jest.fn().mockResolvedValue({
          subject: 'ms-sub-001',
          email: 'm@example.com',
          name: 'Microsoft User',
          emailVerified: true,
        }),
      getHashPassword: jest.fn().mockReturnValue('hashed'),
      newJWTToken:
        overrides?.newJWTToken ?? jest.fn().mockResolvedValue('microsoft-jwt'),
      persistToken:
        overrides?.persistToken ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, userService, authService };
  };

  const buildMicrosoftRes = () => {
    const redirect = jest.fn();
    const cookie = jest.fn();
    const status = jest.fn().mockReturnThis();
    return { redirect, cookie, status } as unknown as express.Response & {
      redirect: jest.Mock;
      cookie: jest.Mock;
      status: jest.Mock;
    };
  };

  const buildReq = (code: string | null = 'mauth-code') =>
    ({
      query: code == null ? {} : { code },
      cookies: {},
      headers: {},
    }) as unknown as express.Request;

  it("creates a new user, links the identity, and stamps signup_origin='microsoft' when the verified email has no existing account", async () => {
    const register = jest.fn().mockResolvedValue([{ id: 11 }]);
    const { controller } = buildMicrosoftController({ register });

    await controller.loginWithMicrosoft(buildReq(), buildMicrosoftRes());

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'm@example.com',
      'microsoft'
    );
    expect(MockedOauthIdentitiesRepo.prototype.link).toHaveBeenCalledWith(
      'microsoft',
      'ms-sub-001',
      11
    );
  });

  it('signs in via subject lookup without calling register or re-linking when the identity already exists', async () => {
    const register = jest.fn();
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = jest
      .fn()
      .mockResolvedValue({
        user_id: 42,
        provider: 'microsoft',
        subject: 'ms-sub-001',
      });
    const getUserById = jest
      .fn()
      .mockResolvedValue({ id: 42, email: 'returner@outlook.com' });

    const { controller } = buildMicrosoftController({ register, getUserById });

    await controller.loginWithMicrosoft(buildReq(), buildMicrosoftRes());

    expect(getUserById).toHaveBeenCalledWith('42');
    expect(register).not.toHaveBeenCalled();
    expect(MockedOauthIdentitiesRepo.prototype.link).not.toHaveBeenCalled();
  });

  it('links the identity to the existing user when verified email matches but no identity row exists yet', async () => {
    const existingUser = { id: 13, email: 'existing@outlook.com' };
    const getUserFrom = jest.fn().mockResolvedValue(existingUser);
    const register = jest.fn();

    const { controller } = buildMicrosoftController({ getUserFrom, register });

    await controller.loginWithMicrosoft(buildReq(), buildMicrosoftRes());

    expect(register).not.toHaveBeenCalled();
    expect(MockedOauthIdentitiesRepo.prototype.link).toHaveBeenCalledWith(
      'microsoft',
      'ms-sub-001',
      13
    );
  });

  it('redirects to /login and records the error when the email is not verified', async () => {
    const register = jest.fn();
    const loginWithMicrosoft = jest.fn().mockResolvedValue({
      subject: 'ms-sub-002',
      email: 'unverified@example.com',
      name: 'Unverified',
      emailVerified: false,
    });
    const { controller } = buildMicrosoftController({
      loginWithMicrosoft,
      register,
    });
    const res = buildMicrosoftRes();

    await controller.loginWithMicrosoft(buildReq(), res);

    expect(res.redirect).toHaveBeenCalledWith(
      '/login?error=microsoft_signin_failed'
    );
    expect(register).not.toHaveBeenCalled();
    expect(MockedOauthIdentitiesRepo.prototype.link).not.toHaveBeenCalled();
  });

  it('redirects to /login when the email claim is missing and no identity exists', async () => {
    const register = jest.fn();
    const loginWithMicrosoft = jest.fn().mockResolvedValue({
      subject: 'ms-sub-003',
      email: undefined,
      name: 'No Email',
      emailVerified: true,
    });
    const { controller } = buildMicrosoftController({
      loginWithMicrosoft,
      register,
    });
    const res = buildMicrosoftRes();

    await controller.loginWithMicrosoft(buildReq(), res);

    expect(res.redirect).toHaveBeenCalledWith(
      '/login?error=microsoft_signin_failed'
    );
    expect(register).not.toHaveBeenCalled();
  });

  it('redirects to /login when the OAuth code is missing', async () => {
    const { controller } = buildMicrosoftController();
    const res = buildMicrosoftRes();

    await controller.loginWithMicrosoft(buildReq(null), res);

    expect(res.redirect).toHaveBeenCalledWith(
      '/login?error=microsoft_signin_failed'
    );
  });

  it('redirects to /login when the token exchange fails', async () => {
    const loginWithMicrosoft = jest.fn().mockResolvedValue(undefined);
    const { controller } = buildMicrosoftController({ loginWithMicrosoft });
    const res = buildMicrosoftRes();

    await controller.loginWithMicrosoft(buildReq('bad-code'), res);

    expect(res.redirect).toHaveBeenCalledWith(
      '/login?error=microsoft_signin_failed'
    );
  });
});

describe('UsersController.loginWithApple', () => {
  const MockedOauthIdentitiesRepo =
    OauthIdentitiesRepository as jest.MockedClass<
      typeof OauthIdentitiesRepository
    >;

  beforeEach(() => {
    MockedOauthIdentitiesRepo.mockClear();
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = jest
      .fn()
      .mockResolvedValue(null);
    MockedOauthIdentitiesRepo.prototype.link = jest
      .fn()
      .mockResolvedValue(undefined);
    MockedOauthIdentitiesRepo.prototype.updateRefreshToken = jest
      .fn()
      .mockResolvedValue(undefined);
  });

  const buildAppleController = (overrides?: {
    getUserFrom?: jest.Mock;
    getUserById?: jest.Mock;
    register?: jest.Mock;
    markEmailVerified?: jest.Mock;
    newJWTToken?: jest.Mock;
    persistToken?: jest.Mock;
    updateLastLoginAt?: jest.Mock;
    loginWithApple?: jest.Mock;
  }) => {
    const mockUser = { id: 20, email: 'apple@example.com' };
    const userService = {
      getUserFrom:
        overrides?.getUserFrom ??
        jest.fn().mockResolvedValueOnce(null).mockResolvedValue(mockUser),
      getUserById:
        overrides?.getUserById ?? jest.fn().mockResolvedValue(mockUser),
      register:
        overrides?.register ?? jest.fn().mockResolvedValue([{ id: 20 }]),
      markEmailVerified:
        overrides?.markEmailVerified ?? jest.fn().mockResolvedValue(1),
      updateLastLoginAt:
        overrides?.updateLastLoginAt ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithApple:
        overrides?.loginWithApple ??
        jest.fn().mockResolvedValue({
          ok: true,
          subject: 'apple-sub-001',
          email: 'apple@example.com',
          emailVerified: true,
        }),
      getHashPassword: jest.fn().mockReturnValue('hashed'),
      newJWTToken:
        overrides?.newJWTToken ?? jest.fn().mockResolvedValue('apple-jwt'),
      persistToken:
        overrides?.persistToken ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, userService, authService };
  };

  const buildAppleRes = () => {
    const redirect = jest.fn();
    const cookie = jest.fn();
    const clearCookie = jest.fn();
    const status = jest.fn().mockReturnThis();
    return {
      redirect,
      cookie,
      clearCookie,
      status,
    } as unknown as express.Response & {
      redirect: jest.Mock;
      cookie: jest.Mock;
      clearCookie: jest.Mock;
      status: jest.Mock;
    };
  };

  const buildReq = (opts?: {
    code?: string | null;
    state?: string;
    stateCookie?: string;
    userField?: string;
  }) => {
    const state = opts?.state ?? 'valid-state-token';
    const stateCookie = opts?.stateCookie ?? 'valid-state-token';
    const code =
      opts?.code === null ? undefined : (opts?.code ?? 'apple-auth-code');
    const body: Record<string, string | undefined> = { state, code };
    if (opts?.userField) {
      body.user = opts.userField;
    }
    return {
      body,
      cookies: stateCookie ? { apple_login_state: stateCookie } : {},
      headers: {},
      query: {},
    } as unknown as express.Request;
  };

  it("creates a new user, links the identity, and stamps signup_origin='apple' when the email has no existing account", async () => {
    const register = jest.fn().mockResolvedValue([{ id: 20 }]);
    const { controller } = buildAppleController({ register });

    await controller.loginWithApple(buildReq(), buildAppleRes());

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'apple@example.com',
      'apple'
    );
    expect(MockedOauthIdentitiesRepo.prototype.link).toHaveBeenCalledWith(
      'apple',
      'apple-sub-001',
      20,
      undefined
    );
  });

  it('stores the Apple refresh token on the linked identity when present', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 20 }]);
    const loginWithApple = jest.fn().mockResolvedValue({
      ok: true,
      subject: 'apple-sub-001',
      email: 'apple@example.com',
      emailVerified: true,
      refreshToken: 'apple-refresh-555',
    });
    const { controller } = buildAppleController({ register, loginWithApple });

    await controller.loginWithApple(buildReq(), buildAppleRes());

    expect(MockedOauthIdentitiesRepo.prototype.link).toHaveBeenCalledWith(
      'apple',
      'apple-sub-001',
      20,
      'apple-refresh-555'
    );
  });

  it('refreshes the stored token when the identity already exists', async () => {
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = jest
      .fn()
      .mockResolvedValue({
        user_id: 20,
        provider: 'apple',
        subject: 'apple-sub-001',
      });
    MockedOauthIdentitiesRepo.prototype.updateRefreshToken = jest
      .fn()
      .mockResolvedValue(undefined);
    const getUserById = jest
      .fn()
      .mockResolvedValue({ id: 20, email: 'apple@example.com' });
    const loginWithApple = jest.fn().mockResolvedValue({
      ok: true,
      subject: 'apple-sub-001',
      email: 'apple@example.com',
      emailVerified: true,
      refreshToken: 'apple-refresh-rotated',
    });

    const { controller } = buildAppleController({
      getUserById,
      loginWithApple,
    });

    await controller.loginWithApple(buildReq(), buildAppleRes());

    expect(
      MockedOauthIdentitiesRepo.prototype.updateRefreshToken
    ).toHaveBeenCalledWith('apple', 'apple-sub-001', 'apple-refresh-rotated');
  });

  it('signs in via subject lookup without calling register when the identity already exists', async () => {
    const register = jest.fn();
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = jest
      .fn()
      .mockResolvedValue({
        user_id: 20,
        provider: 'apple',
        subject: 'apple-sub-001',
      });
    const getUserById = jest
      .fn()
      .mockResolvedValue({ id: 20, email: 'apple@example.com' });

    const { controller } = buildAppleController({ register, getUserById });

    await controller.loginWithApple(buildReq(), buildAppleRes());

    expect(getUserById).toHaveBeenCalledWith('20');
    expect(register).not.toHaveBeenCalled();
    expect(MockedOauthIdentitiesRepo.prototype.link).not.toHaveBeenCalled();
  });

  it('links the identity to the existing user when email matches but no identity row exists yet', async () => {
    const existingUser = { id: 21, email: 'existing@example.com' };
    const getUserFrom = jest.fn().mockResolvedValue(existingUser);
    const register = jest.fn();

    const { controller } = buildAppleController({ getUserFrom, register });

    await controller.loginWithApple(buildReq(), buildAppleRes());

    expect(register).not.toHaveBeenCalled();
    expect(MockedOauthIdentitiesRepo.prototype.link).toHaveBeenCalledWith(
      'apple',
      'apple-sub-001',
      21,
      undefined
    );
  });

  it('redirects to /login when the state cookie is missing', async () => {
    const { controller } = buildAppleController();
    const res = buildAppleRes();

    await controller.loginWithApple(buildReq({ stateCookie: '' }), res);

    expect(res.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects to /login when the state parameter does not match the cookie', async () => {
    const { controller } = buildAppleController();
    const res = buildAppleRes();

    await controller.loginWithApple(
      buildReq({ state: 'tampered', stateCookie: 'valid-state-token' }),
      res
    );

    expect(res.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects to /login when the code is absent', async () => {
    const { controller } = buildAppleController();
    const res = buildAppleRes();

    await controller.loginWithApple(buildReq({ code: null }), res);

    expect(res.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects to /login when the token exchange fails', async () => {
    const loginWithApple = jest.fn().mockResolvedValue({
      ok: false,
      reason: 'token_exchange_failed',
      message: 'HTTP 400 invalid_grant',
    });
    const { controller } = buildAppleController({ loginWithApple });
    const res = buildAppleRes();

    await controller.loginWithApple(buildReq(), res);

    expect(res.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects to /login when email is missing and no identity exists', async () => {
    const loginWithApple = jest.fn().mockResolvedValue({
      ok: true,
      subject: 'apple-sub-noemail',
      email: undefined,
      emailVerified: true,
    });
    const { controller } = buildAppleController({ loginWithApple });
    const res = buildAppleRes();

    await controller.loginWithApple(buildReq(), res);

    expect(res.redirect).toHaveBeenCalledWith('/login');
  });
});

describe('UsersController.deleteAccount — Apple token revocation', () => {
  const MockedOauthIdentitiesRepo =
    OauthIdentitiesRepository as jest.MockedClass<
      typeof OauthIdentitiesRepository
    >;
  const SubscriptionServiceMock = SubscriptionService as unknown as {
    cancelUserSubscriptions: jest.Mock;
  };

  beforeEach(() => {
    MockedOauthIdentitiesRepo.mockClear();
    SubscriptionServiceMock.cancelUserSubscriptions = jest
      .fn()
      .mockResolvedValue(undefined);
  });

  const buildDeleteController = (overrides?: {
    refreshToken?: string | null;
    revokeAppleToken?: jest.Mock;
    deleteUser?: jest.Mock;
  }) => {
    MockedOauthIdentitiesRepo.prototype.findRefreshTokenByUserAndProvider = jest
      .fn()
      .mockResolvedValue(overrides?.refreshToken ?? null);
    const deleteUser =
      overrides?.deleteUser ?? jest.fn().mockResolvedValue(undefined);
    const userService = {
      getUserById: jest
        .fn()
        .mockResolvedValue({ id: 42, email: 'apple@example.com' }),
      deleteUser,
    } as unknown as UsersService;
    const authService = {
      revokeAppleToken:
        overrides?.revokeAppleToken ?? jest.fn().mockResolvedValue(true),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, userService, authService, deleteUser };
  };

  const buildDeleteReq = () =>
    ({
      body: {},
      cookies: {},
      headers: {},
      query: {},
    }) as unknown as express.Request;

  const buildDeleteRes = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return { json, status } as unknown as express.Response & {
      json: jest.Mock;
      status: jest.Mock;
    };
  };

  it('revokes the stored Apple refresh token before deleting the user', async () => {
    const revokeAppleToken = jest.fn().mockResolvedValue(true);
    const deleteUser = jest.fn().mockResolvedValue(undefined);
    const { controller } = buildDeleteController({
      refreshToken: 'apple-refresh-del',
      revokeAppleToken,
      deleteUser,
    });
    const res = buildDeleteRes();

    await controller.deleteAccount(
      buildDeleteReq(),
      Object.assign(res, {
        locals: { owner: '42' },
      }) as unknown as express.Response
    );

    expect(revokeAppleToken).toHaveBeenCalledWith('apple-refresh-del');
    const revokeOrder = revokeAppleToken.mock.invocationCallOrder[0];
    const deleteOrder = deleteUser.mock.invocationCallOrder[0];
    expect(revokeOrder).toBeLessThan(deleteOrder);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('completes deletion without revoking when no Apple identity token exists', async () => {
    const revokeAppleToken = jest.fn();
    const deleteUser = jest.fn().mockResolvedValue(undefined);
    const { controller } = buildDeleteController({
      refreshToken: null,
      revokeAppleToken,
      deleteUser,
    });
    const res = buildDeleteRes();

    await controller.deleteAccount(
      buildDeleteReq(),
      Object.assign(res, {
        locals: { owner: '42' },
      }) as unknown as express.Response
    );

    expect(revokeAppleToken).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith('42');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('still deletes the account when Apple revocation throws', async () => {
    const revokeAppleToken = jest
      .fn()
      .mockRejectedValue(new Error('apple revoke down'));
    const deleteUser = jest.fn().mockResolvedValue(undefined);
    const { controller } = buildDeleteController({
      refreshToken: 'apple-refresh-del',
      revokeAppleToken,
      deleteUser,
    });
    const res = buildDeleteRes();

    await controller.deleteAccount(
      buildDeleteReq(),
      Object.assign(res, {
        locals: { owner: '42' },
      }) as unknown as express.Response
    );

    expect(deleteUser).toHaveBeenCalledWith('42');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('aborts the deletion with 502 when the subscription cancel fails', async () => {
    SubscriptionServiceMock.cancelUserSubscriptions = jest
      .fn()
      .mockRejectedValue(new Error('stripe down'));
    const deleteUser = jest.fn().mockResolvedValue(undefined);
    const { controller } = buildDeleteController({ deleteUser });
    const res = buildDeleteRes();

    await controller.deleteAccount(
      buildDeleteReq(),
      Object.assign(res, {
        locals: { owner: '42' },
      }) as unknown as express.Response
    );

    expect(deleteUser).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(502);
  });
});

describe('UsersController.login — Notion-aware redirect', () => {
  const MockedNotionRepo = NotionRepository as jest.MockedClass<
    typeof NotionRepository
  >;

  beforeEach(() => {
    MockedNotionRepo.mockClear();
    MockedNotionRepo.prototype.getNotionData = jest
      .fn()
      .mockResolvedValue(null);
  });

  const buildLoginController = (overrides?: {
    comparePassword?: jest.Mock;
    newJWTToken?: jest.Mock;
    persistToken?: jest.Mock;
  }) => {
    const mockUser = { id: 5, email: 'u@example.com', pw: 'mock' };
    const userService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
      updateLastLoginAt: jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      isValidLogin: jest.fn().mockReturnValue(true),
      comparePassword:
        overrides?.comparePassword ?? jest.fn().mockReturnValue(true),
      newJWTToken:
        overrides?.newJWTToken ?? jest.fn().mockResolvedValue('login-jwt'),
      persistToken:
        overrides?.persistToken ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller };
  };

  const buildLoginRes = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const cookie = jest.fn();
    return { json, status, cookie } as unknown as express.Response & {
      json: jest.Mock;
      status: jest.Mock;
      cookie: jest.Mock;
    };
  };

  it('redirects to /upload when user has no Notion token and no redirect param', async () => {
    MockedNotionRepo.prototype.getNotionData = jest
      .fn()
      .mockResolvedValue(null);
    const { controller } = buildLoginController();
    const req = {
      body: { email: 'u@example.com', credentials: 'mock' },
      query: {},
    } as unknown as express.Request;
    const res = buildLoginRes();
    const next = jest.fn();

    await controller.login(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.redirect).toBe('/upload');
  });

  it('redirects to /notion when user has a Notion token and no redirect param', async () => {
    MockedNotionRepo.prototype.getNotionData = jest
      .fn()
      .mockResolvedValue({ token: 'stored-tok', owner: 5 });
    const { controller } = buildLoginController();
    const req = {
      body: { email: 'u@example.com', credentials: 'mock' },
      query: {},
    } as unknown as express.Request;
    const res = buildLoginRes();
    const next = jest.fn();

    await controller.login(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.redirect).toBe('/notion');
  });

  it('respects explicit ?redirect= param even for Notion users', async () => {
    MockedNotionRepo.prototype.getNotionData = jest
      .fn()
      .mockResolvedValue({ token: 'stored-tok', owner: 5 });
    const { controller } = buildLoginController();
    const req = {
      body: { email: 'u@example.com', credentials: 'mock' },
      query: { redirect: '/downloads' },
    } as unknown as express.Request;
    const res = buildLoginRes();
    const next = jest.fn();

    await controller.login(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.redirect).toBe('/downloads');
  });
});

describe('UsersController.loginWithNotion — error recording', () => {
  const buildNotionController = (
    loginWithNotionResult: Record<string, unknown> | null,
    getUserFromResult: Record<string, unknown> | null = null
  ) => {
    const recordExecute = jest.fn().mockResolvedValue(undefined);
    const recordError = { execute: recordExecute };

    const authService = {
      loginWithNotion: jest.fn().mockResolvedValue(loginWithNotionResult),
      getHashPassword: jest.fn().mockReturnValue('hashed'),
      newJWTToken: jest.fn().mockResolvedValue(null),
      persistToken: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const userService = {
      getUserFrom: jest.fn().mockResolvedValue(getUserFromResult),
      register: jest.fn().mockResolvedValue(undefined),
      updateLastLoginAt: jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>,
      recordError as unknown as import('../usecases/observability/RecordUserVisibleErrorUseCase').RecordUserVisibleErrorUseCase
    );
    return { controller, recordExecute };
  };

  const buildRedirectRes = () => {
    const redirect = jest.fn();
    const status = jest.fn().mockReturnValue({ send: jest.fn() });
    return { redirect, status } as unknown as express.Response & {
      redirect: jest.Mock;
      status: jest.Mock;
    };
  };

  it('records oauth_cancelled when code query param is absent', async () => {
    const { controller, recordExecute } = buildNotionController(null);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRedirectRes();

    await controller.loginWithNotion(req, res);

    expect(recordExecute).toHaveBeenCalledWith({
      userId: null,
      surface: 'oauth_notion',
      code: 'oauth_cancelled',
    });
    expect(res.redirect).toHaveBeenCalledWith('/login?error=notion_cancelled');
  });

  it('records oauth_token_exchange_failed when loginWithNotion returns null', async () => {
    const { controller, recordExecute } = buildNotionController(null);
    const req = {
      query: { code: 'notion-code' },
    } as unknown as express.Request;
    const res = buildRedirectRes();

    await controller.loginWithNotion(req, res);

    expect(recordExecute).toHaveBeenCalledWith({
      userId: null,
      surface: 'oauth_notion',
      code: 'oauth_token_exchange_failed',
    });
  });

  it('records oauth_user_creation_failed when user lookup returns null after register', async () => {
    const { controller, recordExecute } = buildNotionController(
      { email: 'n@notion.so', name: 'N', accessData: {} },
      null
    );
    const req = {
      query: { code: 'notion-code' },
      headers: {},
    } as unknown as express.Request;
    const res = buildRedirectRes();

    await controller.loginWithNotion(req, res);

    expect(recordExecute).toHaveBeenCalledWith({
      userId: null,
      surface: 'oauth_notion',
      code: 'oauth_user_creation_failed',
    });
  });
});

describe('UsersController.loginWithGoogle — error recording', () => {
  const buildOAuthController = (
    loginWithGoogleResult: Record<string, unknown> | null,
    getUserFromResult: Record<string, unknown> | null = null
  ) => {
    const recordExecute = jest.fn().mockResolvedValue(undefined);
    const recordError = { execute: recordExecute };

    const authService = {
      loginWithGoogle: jest.fn().mockResolvedValue(loginWithGoogleResult),
      getHashPassword: jest.fn().mockReturnValue('hashed'),
      newJWTToken: jest.fn().mockResolvedValue(null),
      persistToken: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const userService = {
      getUserFrom: jest.fn().mockResolvedValue(getUserFromResult),
      register: jest.fn().mockResolvedValue(undefined),
      updateLastLoginAt: jest.fn().mockResolvedValue(undefined),
      markEmailVerified: jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>,
      recordError as unknown as import('../usecases/observability/RecordUserVisibleErrorUseCase').RecordUserVisibleErrorUseCase
    );
    return { controller, recordExecute };
  };

  const buildRedirectRes = () => {
    const redirect = jest.fn();
    const status = jest.fn().mockReturnValue({ send: jest.fn() });
    return { redirect, status } as unknown as express.Response & {
      redirect: jest.Mock;
      status: jest.Mock;
    };
  };

  it('records oauth_cancelled when code query param is absent', async () => {
    const { controller, recordExecute } = buildOAuthController(null);
    const req = { query: {} } as unknown as express.Request;
    const res = buildRedirectRes();

    await controller.loginWithGoogle(req, res);

    expect(recordExecute).toHaveBeenCalledWith({
      userId: null,
      surface: 'oauth_google',
      code: 'oauth_cancelled',
    });
    expect(res.redirect).toHaveBeenCalledWith(
      '/login?error=google_signin_failed'
    );
  });

  it('records the real failure reason when loginWithGoogle reports a verify failure', async () => {
    const { controller, recordExecute } = buildOAuthController({
      ok: false,
      reason: 'verify_failed',
      message: 'JsonWebTokenError: invalid signature',
    });
    const req = {
      query: { code: 'auth-code-123' },
    } as unknown as express.Request;
    const res = buildRedirectRes();

    await controller.loginWithGoogle(req, res);

    expect(recordExecute).toHaveBeenCalledWith({
      userId: null,
      surface: 'oauth_google',
      code: 'oauth_token_exchange_failed',
      context: {
        reason: 'verify_failed',
        message: 'JsonWebTokenError: invalid signature',
        userAgent: null,
      },
    });
    expect(res.redirect).toHaveBeenCalledWith(
      '/login?error=google_signin_failed'
    );
  });

  it('records oauth_user_creation_failed when user lookup returns null after register', async () => {
    const { controller, recordExecute } = buildOAuthController(
      { ok: true, email: 'x@google.com', name: 'X' },
      null
    );
    const req = {
      query: { code: 'auth-code-123' },
      headers: {},
    } as unknown as express.Request;
    const res = buildRedirectRes();

    await controller.loginWithGoogle(req, res);

    expect(recordExecute).toHaveBeenCalledWith({
      userId: null,
      surface: 'oauth_google',
      code: 'oauth_user_creation_failed',
    });
  });
});

describe('UsersController.loginWithNotion', () => {
  const buildNotionDb = () => {
    const chainable: Record<string, jest.Mock> = {};
    const methods = [
      'insert',
      'where',
      'first',
      'whereNull',
      'update',
      'onConflict',
      'merge',
    ];
    for (const m of methods) {
      chainable[m] = jest.fn().mockReturnValue(Promise.resolve([1]));
    }
    for (const m of ['where', 'whereNull', 'onConflict']) {
      chainable[m] = jest.fn().mockReturnValue(chainable);
    }
    chainable['insert'] = jest.fn().mockReturnValue(chainable);
    chainable['merge'] = jest.fn().mockResolvedValue([1]);
    const mockDb = jest.fn().mockReturnValue(chainable);
    return mockDb as unknown as ReturnType<
      typeof import('../data_layer').getDatabase
    >;
  };

  const buildNotionController = (overrides?: {
    getUserFrom?: jest.Mock;
    register?: jest.Mock;
    newJWTToken?: jest.Mock;
    persistToken?: jest.Mock;
    updateLastLoginAt?: jest.Mock;
    loginWithNotion?: jest.Mock;
  }) => {
    const mockUser = { id: 11, email: 'n@example.com' };
    const userService = {
      getUserFrom:
        overrides?.getUserFrom ??
        jest.fn().mockResolvedValueOnce(null).mockResolvedValue(mockUser),
      register:
        overrides?.register ?? jest.fn().mockResolvedValue([{ id: 11 }]),
      updateLastLoginAt:
        overrides?.updateLastLoginAt ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithNotion:
        overrides?.loginWithNotion ??
        jest.fn().mockResolvedValue({
          email: 'n@example.com',
          name: 'Notion User',
          accessData: {},
        }),
      getHashPassword: jest.fn().mockReturnValue('hashed'),
      newJWTToken:
        overrides?.newJWTToken ?? jest.fn().mockResolvedValue('notion-jwt'),
      persistToken:
        overrides?.persistToken ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      buildNotionDb()
    );
    return { controller, userService, authService };
  };

  const buildNotionRes = () => {
    const redirect = jest.fn();
    const cookie = jest.fn();
    const status = jest.fn().mockReturnThis();
    return { redirect, cookie, status } as unknown as express.Response & {
      redirect: jest.Mock;
      cookie: jest.Mock;
      status: jest.Mock;
    };
  };

  it("registers new Notion users with signup_origin set to 'notion_oauth'", async () => {
    const register = jest.fn().mockResolvedValue([{ id: 11 }]);
    const { controller } = buildNotionController({ register });
    const req = {
      query: { code: 'notion-code' },
      cookies: {},
      headers: {},
    } as unknown as express.Request;
    const res = buildNotionRes();

    await controller.loginWithNotion(req, res);

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'n@example.com',
      'notion_oauth'
    );
  });

  it('does not call register for an existing Notion user', async () => {
    const existingUser = { id: 12, email: 'existing@example.com' };
    const getUserFrom = jest.fn().mockResolvedValue(existingUser);
    const register = jest.fn();
    const { controller } = buildNotionController({ getUserFrom, register });
    const req = {
      query: { code: 'notion-code' },
      cookies: {},
      headers: {},
    } as unknown as express.Request;
    const res = buildNotionRes();

    await controller.loginWithNotion(req, res);

    expect(register).not.toHaveBeenCalled();
  });
});

describe('UsersController cookie options — 30-day persistent session', () => {
  const EXPECTED_COOKIE_OPTIONS = {
    maxAge: SESSION_MAX_AGE_MS,
    httpOnly: false,
    sameSite: 'lax',
  };

  it('sets maxAge, httpOnly, and sameSite on the token cookie during email/password login', async () => {
    const MockedNotionRepo = NotionRepository as jest.MockedClass<
      typeof NotionRepository
    >;
    MockedNotionRepo.prototype.getNotionData = jest
      .fn()
      .mockResolvedValue(null);
    const mockUser = { id: 5, email: 'u@example.com', pw: '$2b$10$hash' };
    const userService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
      updateLastLoginAt: jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      isValidLogin: jest.fn().mockReturnValue(true),
      comparePassword: jest.fn().mockReturnValue(true),
      newJWTToken: jest.fn().mockResolvedValue('login-jwt'),
      persistToken: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = {
      body: { email: 'u@example.com', credentials: 'mock' },
      query: {},
    } as unknown as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.login(req, res, next);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'login-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });

  it('sets maxAge, httpOnly, and sameSite on the token cookie during registration', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 1 }]);
    const newJWTToken = jest.fn().mockResolvedValue('register-jwt');
    const { controller } = buildController({ register, newJWTToken });
    const req = {
      body: { email: 'new@example.com', password: SAMPLE_PW },
      query: {},
    } as unknown as express.Request;
    const res = buildRes();
    const next = jest.fn();

    await controller.register(req, res, next);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'register-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });

  it('sets maxAge, httpOnly, and sameSite on the token cookie during magic link verification', async () => {
    const verifyMagicToken = jest
      .fn()
      .mockResolvedValue({ userId: 5, purpose: 'login' });
    const newJWTToken = jest.fn().mockResolvedValue('magic-jwt');
    const persistToken = jest.fn().mockResolvedValue(undefined);
    const updateLastLoginAt = jest.fn().mockResolvedValue(undefined);
    const getUserById = jest
      .fn()
      .mockResolvedValue({ id: 5, email: 'al@example.com' });
    const markEmailVerified = jest.fn().mockResolvedValue(1);
    const userService = {
      verifyMagicToken,
      getUserById,
      updateLastLoginAt,
      markEmailVerified,
    } as unknown as UsersService;
    const authService = {
      newJWTToken,
      persistToken,
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = {
      params: { token: 'magic-tok' },
    } as unknown as express.Request;
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      cookie: jest.fn(),
    } as unknown as express.Response & { cookie: jest.Mock };
    const next = jest.fn();

    await controller.verifyMagicLink(req, res, next);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'magic-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });

  it('sets maxAge, httpOnly, and sameSite on the token cookie during Google OAuth login', async () => {
    const mockUser = { id: 7, email: 'g@example.com' };
    const MockedNotionRepo = NotionRepository as jest.MockedClass<
      typeof NotionRepository
    >;
    MockedNotionRepo.prototype.getNotionData = jest
      .fn()
      .mockResolvedValue(null);
    const userService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
      register: jest.fn().mockResolvedValue([{ id: 7 }]),
      markEmailVerified: jest.fn().mockResolvedValue(1),
      updateLastLoginAt: jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const newJWTToken = jest.fn().mockResolvedValue('google-jwt');
    const authService = {
      loginWithGoogle: jest
        .fn()
        .mockResolvedValue({ ok: true, email: 'g@example.com', name: 'G' }),
      getHashPassword: jest.fn().mockReturnValue('hashed'),
      newJWTToken,
      persistToken: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = {
      query: { code: 'gauth' },
      cookies: {},
      headers: {},
    } as unknown as express.Request;
    const res = {
      redirect: jest.fn(),
      cookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as express.Response & { cookie: jest.Mock };

    await controller.loginWithGoogle(req, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'google-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });

  it('sets maxAge, httpOnly, and sameSite on the token cookie during Microsoft OAuth login', async () => {
    const MockedOauthIdentitiesRepo =
      OauthIdentitiesRepository as jest.MockedClass<
        typeof OauthIdentitiesRepository
      >;
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = jest
      .fn()
      .mockResolvedValue(null);
    MockedOauthIdentitiesRepo.prototype.link = jest
      .fn()
      .mockResolvedValue(undefined);
    const MockedNotionRepo = NotionRepository as jest.MockedClass<
      typeof NotionRepository
    >;
    MockedNotionRepo.prototype.getNotionData = jest
      .fn()
      .mockResolvedValue(null);

    const mockUser = { id: 11, email: 'm@example.com' };
    const newJWTToken = jest.fn().mockResolvedValue('microsoft-jwt');
    const userService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
      getUserById: jest.fn().mockResolvedValue(mockUser),
      register: jest.fn().mockResolvedValue([{ id: 11 }]),
      markEmailVerified: jest.fn().mockResolvedValue(1),
      updateLastLoginAt: jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithMicrosoft: jest.fn().mockResolvedValue({
        subject: 'ms-sub',
        email: 'm@example.com',
        name: 'M',
        emailVerified: true,
      }),
      getHashPassword: jest.fn().mockReturnValue('hashed'),
      newJWTToken,
      persistToken: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = {
      query: { code: 'mauth' },
      cookies: {},
      headers: {},
    } as unknown as express.Request;
    const res = {
      redirect: jest.fn(),
      cookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as express.Response & { cookie: jest.Mock };

    await controller.loginWithMicrosoft(req, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'microsoft-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });

  it('sets maxAge, httpOnly, and sameSite on the token cookie during Apple OAuth login', async () => {
    const MockedOauthIdentitiesRepo =
      OauthIdentitiesRepository as jest.MockedClass<
        typeof OauthIdentitiesRepository
      >;
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = jest
      .fn()
      .mockResolvedValue(null);
    MockedOauthIdentitiesRepo.prototype.link = jest
      .fn()
      .mockResolvedValue(undefined);
    const MockedNotionRepo = NotionRepository as jest.MockedClass<
      typeof NotionRepository
    >;
    MockedNotionRepo.prototype.getNotionData = jest
      .fn()
      .mockResolvedValue(null);

    const mockUser = { id: 20, email: 'apple@example.com' };
    const newJWTToken = jest.fn().mockResolvedValue('apple-jwt');
    const userService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
      getUserById: jest.fn().mockResolvedValue(mockUser),
      register: jest.fn().mockResolvedValue([{ id: 20 }]),
      markEmailVerified: jest.fn().mockResolvedValue(1),
      updateLastLoginAt: jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithApple: jest.fn().mockResolvedValue({
        ok: true,
        subject: 'apple-sub',
        email: 'apple@example.com',
        emailVerified: true,
      }),
      getHashPassword: jest.fn().mockReturnValue('hashed'),
      newJWTToken,
      persistToken: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = {
      body: { state: 'valid-state', code: 'apple-code' },
      cookies: { apple_login_state: 'valid-state' },
      headers: {},
      query: {},
    } as unknown as express.Request;
    const res = {
      redirect: jest.fn(),
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as express.Response & { cookie: jest.Mock };

    await controller.loginWithApple(req, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'apple-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });

  it('sets maxAge, httpOnly, and sameSite on the token cookie during Notion OAuth login', async () => {
    const chainable: Record<string, jest.Mock> = {};
    const methods = [
      'insert',
      'where',
      'first',
      'whereNull',
      'update',
      'onConflict',
      'merge',
    ];
    for (const m of methods) {
      chainable[m] = jest.fn().mockReturnValue(Promise.resolve([1]));
    }
    for (const m of ['where', 'whereNull', 'onConflict']) {
      chainable[m] = jest.fn().mockReturnValue(chainable);
    }
    chainable['insert'] = jest.fn().mockReturnValue(chainable);
    chainable['merge'] = jest.fn().mockResolvedValue([1]);
    const mockDb = jest
      .fn()
      .mockReturnValue(chainable) as unknown as ReturnType<
      typeof import('../data_layer').getDatabase
    >;

    const mockUser = { id: 11, email: 'n@example.com' };
    const newJWTToken = jest.fn().mockResolvedValue('notion-jwt');
    const userService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
      register: jest.fn().mockResolvedValue([{ id: 11 }]),
      updateLastLoginAt: jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithNotion: jest.fn().mockResolvedValue({
        email: 'n@example.com',
        name: 'N',
        accessData: {},
      }),
      getHashPassword: jest.fn().mockReturnValue('hashed'),
      newJWTToken,
      persistToken: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(userService, authService, mockDb);
    const req = {
      query: { code: 'notion-code' },
      cookies: {},
      headers: {},
    } as unknown as express.Request;
    const res = {
      redirect: jest.fn(),
      cookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as express.Response & { cookie: jest.Mock };

    await controller.loginWithNotion(req, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'notion-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });
});

describe('UsersController.getLocals', () => {
  it('includes email_verified in the user object', async () => {
    const mockUser = {
      id: 1,
      email: 'al@example.com',
      email_verified: true,
      patreon: false,
      ankify_welcome_seen: false,
      hosted_anki_requested_at: null,
      owner: 1,
    };
    const userService = {
      getSubscriptionLinkedEmail: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {},
      json: jest.fn(),
    } as unknown as express.Response & { json: jest.Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.user.email_verified).toBe(true);
  });

  it('marks autoSyncActive true for a patreon lifetime user with no Auto Sync subscription', async () => {
    (
      SubscriptionService.getUserActiveSubscriptions as jest.Mock
    ).mockResolvedValueOnce([]);
    const mockUser = {
      id: 42,
      email: 'lifetime@example.com',
      email_verified: true,
      patreon: true,
      ankify_welcome_seen: false,
      hosted_anki_requested_at: null,
      owner: 42,
    };
    const userService = {
      getSubscriptionLinkedEmail: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {},
      json: jest.fn(),
    } as unknown as express.Response & { json: jest.Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.autoSyncActive).toBe(true);
  });

  it('offers the pass ladder to a repeat pass buyer', async () => {
    mockCountPaidPassesSince.mockResolvedValueOnce({
      dayPasses: 2,
      weekPasses: 0,
    });
    const mockUser = {
      id: 9,
      email: 'buyer@example.com',
      email_verified: true,
      patreon: false,
      ankify_welcome_seen: false,
      hosted_anki_requested_at: null,
      owner: 9,
    };
    const userService = {
      getSubscriptionLinkedEmail: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: { planSource: null },
      json: jest.fn(),
    } as unknown as express.Response & { json: jest.Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.passLadder).toEqual({ passCount: 2, spentUsd: 8 });
  });

  it('sends no pass ladder to a subscriber', async () => {
    mockCountPaidPassesSince.mockResolvedValueOnce({
      dayPasses: 2,
      weekPasses: 1,
    });
    const mockUser = {
      id: 10,
      email: 'sub@example.com',
      email_verified: true,
      patreon: false,
      ankify_welcome_seen: false,
      hosted_anki_requested_at: null,
      owner: 10,
    };
    const userService = {
      getSubscriptionLinkedEmail: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: { planSource: 'stripe' },
      json: jest.fn(),
    } as unknown as express.Response & { json: jest.Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.passLadder).toBeNull();
  });

  it('surfaces chat_consent_at on the user object so the consent modal closes after accept', async () => {
    const consentAt = new Date('2026-05-16T20:00:00.000Z');
    const mockUser = {
      id: 3,
      email: 'c@example.com',
      email_verified: true,
      patreon: false,
      ankify_welcome_seen: false,
      hosted_anki_requested_at: null,
      chat_consent_at: consentAt,
      owner: 3,
    };
    const userService = {
      getSubscriptionLinkedEmail: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {},
      json: jest.fn(),
    } as unknown as express.Response & { json: jest.Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.user.chat_consent_at).toEqual(consentAt);
  });

  it('defaults chat_consent_at to null when the user has not consented', async () => {
    const mockUser = {
      id: 4,
      email: 'd@example.com',
      email_verified: true,
      patreon: false,
      ankify_welcome_seen: false,
      hosted_anki_requested_at: null,
      chat_consent_at: null,
      owner: 4,
    };
    const userService = {
      getSubscriptionLinkedEmail: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {},
      json: jest.fn(),
    } as unknown as express.Response & { json: jest.Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.user.chat_consent_at).toBeNull();
  });

  it('maps a Day Pass holder to passKind 24h with a future expiry and null planSource', async () => {
    const mockUser = {
      id: 5,
      email: 'pass@example.com',
      email_verified: true,
      patreon: false,
      ankify_welcome_seen: false,
      hosted_anki_requested_at: null,
      owner: 5,
    };
    const userService = {
      getSubscriptionLinkedEmail: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {
        subscriber: true,
        passKind: '24h',
        passExpiresAt: '2026-06-07T00:00:00.000Z',
        planSource: null,
      },
      json: jest.fn(),
    } as unknown as express.Response & { json: jest.Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.entitlement).toEqual({
      passKind: '24h',
      passExpiresAt: '2026-06-07T00:00:00.000Z',
      planSource: null,
    });
  });

  it('maps an unlimited subscriber to entitlement passKind unlimited with stripe planSource', async () => {
    const mockUser = {
      id: 6,
      email: 'sub@example.com',
      email_verified: true,
      patreon: false,
      ankify_welcome_seen: false,
      hosted_anki_requested_at: null,
      owner: 6,
    };
    const userService = {
      getSubscriptionLinkedEmail: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {
        subscriber: true,
        planSource: 'stripe',
      },
      json: jest.fn(),
    } as unknown as express.Response & { json: jest.Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.entitlement).toEqual({
      passKind: 'unlimited',
      passExpiresAt: null,
      planSource: 'stripe',
    });
  });

  it('maps a Week Pass holder to entitlement passKind 7d', async () => {
    const mockUser = {
      id: 7,
      email: 'week@example.com',
      email_verified: true,
      patreon: false,
      ankify_welcome_seen: false,
      hosted_anki_requested_at: null,
      owner: 7,
    };
    const userService = {
      getSubscriptionLinkedEmail: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {
        subscriber: true,
        passKind: '7d',
        passExpiresAt: '2026-06-12T00:00:00.000Z',
        planSource: null,
      },
      json: jest.fn(),
    } as unknown as express.Response & { json: jest.Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.entitlement).toEqual({
      passKind: '7d',
      passExpiresAt: '2026-06-12T00:00:00.000Z',
      planSource: null,
    });
  });

  it('returns an all-null entitlement for a free user', async () => {
    const mockUser = {
      id: 8,
      email: 'free@example.com',
      email_verified: true,
      patreon: false,
      ankify_welcome_seen: false,
      hosted_anki_requested_at: null,
      owner: 8,
    };
    const userService = {
      getSubscriptionLinkedEmail: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {},
      json: jest.fn(),
    } as unknown as express.Response & { json: jest.Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.entitlement).toEqual({
      passKind: null,
      passExpiresAt: null,
      planSource: null,
    });
  });

  it('defaults email_verified to false when user has no value', async () => {
    const mockUser = {
      id: 2,
      email: 'b@example.com',
      email_verified: undefined,
      patreon: false,
      ankify_welcome_seen: false,
      hosted_anki_requested_at: null,
      owner: 2,
    };
    const userService = {
      getSubscriptionLinkedEmail: jest.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: jest.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {},
      json: jest.fn(),
    } as unknown as express.Response & { json: jest.Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.user.email_verified).toBe(false);
  });
});

describe('UsersController.cancelSubscription', () => {
  const buildCancelController = (dbMock?: unknown) => {
    const userService = {
      getUserById: jest
        .fn()
        .mockResolvedValue({ id: 1, email: 'sub@example.com' }),
    } as unknown as UsersService;
    const controller = new UsersController(
      userService,
      {} as AuthenticationService,
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

describe('UsersController.pauseSubscription', () => {
  const buildPauseController = () => {
    const userService = {
      getUserById: jest
        .fn()
        .mockResolvedValue({ id: 1, email: 'sub@example.com' }),
    } as unknown as UsersService;
    const controller = new UsersController(
      userService,
      {} as AuthenticationService,
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
    const controller = new UsersController(
      userService,
      {} as AuthenticationService,
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
    const controller = new UsersController(
      userService,
      {} as AuthenticationService,
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

describe('UsersController.loginWithAppleNative', () => {
  const MockedOauthIdentitiesRepo =
    OauthIdentitiesRepository as jest.MockedClass<
      typeof OauthIdentitiesRepository
    >;

  beforeEach(() => {
    MockedOauthIdentitiesRepo.mockClear();
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = jest
      .fn()
      .mockResolvedValue(null);
    MockedOauthIdentitiesRepo.prototype.link = jest
      .fn()
      .mockResolvedValue(undefined);
  });

  const buildNativeController = (overrides?: {
    getUserFrom?: jest.Mock;
    getUserById?: jest.Mock;
    register?: jest.Mock;
    markEmailVerified?: jest.Mock;
    newJWTToken?: jest.Mock;
    persistToken?: jest.Mock;
    updateLastLoginAt?: jest.Mock;
    verifyAppleIdentityToken?: jest.Mock;
  }) => {
    const recordExecute = jest.fn().mockResolvedValue(undefined);
    const mockUser = { id: 30, email: 'native-apple@example.com' };
    const userService = {
      getUserFrom:
        overrides?.getUserFrom ??
        jest.fn().mockResolvedValueOnce(null).mockResolvedValue(mockUser),
      getUserById:
        overrides?.getUserById ?? jest.fn().mockResolvedValue(mockUser),
      register:
        overrides?.register ?? jest.fn().mockResolvedValue([{ id: 30 }]),
      markEmailVerified:
        overrides?.markEmailVerified ?? jest.fn().mockResolvedValue(1),
      updateLastLoginAt:
        overrides?.updateLastLoginAt ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      verifyAppleIdentityToken:
        overrides?.verifyAppleIdentityToken ??
        jest.fn().mockResolvedValue({
          subject: 'native-sub-001',
          email: 'native-apple@example.com',
        }),
      getHashPassword: jest.fn().mockReturnValue('hashed'),
      newJWTToken:
        overrides?.newJWTToken ??
        jest.fn().mockResolvedValue('native-apple-jwt'),
      persistToken:
        overrides?.persistToken ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>,
      {
        execute: recordExecute,
      } as unknown as import('../usecases/observability/RecordUserVisibleErrorUseCase').RecordUserVisibleErrorUseCase
    );
    return { controller, userService, authService, recordExecute };
  };

  const buildNativeRes = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const cookie = jest.fn();
    return { json, status, cookie } as unknown as express.Response & {
      json: jest.Mock;
      status: jest.Mock;
      cookie: jest.Mock;
    };
  };

  const buildReq = (body: Record<string, unknown> = {}) =>
    ({
      body: { identityToken: 'apple-id-token', ...body },
      headers: {},
    }) as unknown as express.Request;

  it('returns 400 when identityToken is missing from the request body', async () => {
    const { controller } = buildNativeController();
    const req = { body: {}, headers: {} } as unknown as express.Request;
    const res = buildNativeRes();

    await controller.loginWithAppleNative(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'missing_identity_token' });
  });

  it('returns 401 and records the error when the identity token fails verification', async () => {
    const verifyAppleIdentityToken = jest.fn().mockResolvedValue(undefined);
    const { controller, recordExecute } = buildNativeController({
      verifyAppleIdentityToken,
    });
    const res = buildNativeRes();

    await controller.loginWithAppleNative(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_identity_token' });
    expect(recordExecute).toHaveBeenCalledWith({
      userId: null,
      surface: 'oauth_apple_native',
      code: 'invalid_identity_token',
    });
  });

  it('sets a JWT cookie and returns 200 { ok: true } on successful sign-in', async () => {
    const { controller } = buildNativeController();
    const res = buildNativeRes();

    await controller.loginWithAppleNative(buildReq(), res);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'native-apple-jwt',
      expect.objectContaining({ httpOnly: false, sameSite: 'lax' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('creates a new user and links the Apple identity when no account exists', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 30 }]);
    const { controller } = buildNativeController({ register });
    const res = buildNativeRes();

    await controller.loginWithAppleNative(buildReq(), res);

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'native-apple@example.com',
      'apple'
    );
    expect(MockedOauthIdentitiesRepo.prototype.link).toHaveBeenCalledWith(
      'apple',
      'native-sub-001',
      30,
      undefined
    );
  });

  it('signs in via subject lookup without re-registering when the identity already exists', async () => {
    const register = jest.fn();
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = jest
      .fn()
      .mockResolvedValue({
        user_id: 30,
        provider: 'apple',
        subject: 'native-sub-001',
      });
    const getUserById = jest
      .fn()
      .mockResolvedValue({ id: 30, email: 'native-apple@example.com' });

    const { controller } = buildNativeController({ register, getUserById });
    const res = buildNativeRes();

    await controller.loginWithAppleNative(buildReq(), res);

    expect(register).not.toHaveBeenCalled();
    expect(getUserById).toHaveBeenCalledWith('30');
    expect(MockedOauthIdentitiesRepo.prototype.link).not.toHaveBeenCalled();
  });

  it('returns 401 when email is absent and no existing identity row exists', async () => {
    const verifyAppleIdentityToken = jest
      .fn()
      .mockResolvedValue({ subject: 'native-sub-noemail', email: undefined });
    const { controller } = buildNativeController({ verifyAppleIdentityToken });
    const res = buildNativeRes();

    await controller.loginWithAppleNative(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'email_required_for_new_account',
    });
  });

  it('uses fullName from request body when creating a new account', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 30 }]);
    const { controller } = buildNativeController({ register });
    const res = buildNativeRes();

    await controller.loginWithAppleNative(
      buildReq({ fullName: { givenName: 'Jane', familyName: 'Doe' } }),
      res
    );

    expect(register).toHaveBeenCalledWith(
      'Jane Doe',
      expect.any(String),
      'native-apple@example.com',
      'apple'
    );
  });

  it('falls back to email as name when fullName is absent', async () => {
    const register = jest.fn().mockResolvedValue([{ id: 30 }]);
    const { controller } = buildNativeController({ register });
    const res = buildNativeRes();

    await controller.loginWithAppleNative(buildReq(), res);

    expect(register).toHaveBeenCalledWith(
      'native-apple@example.com',
      expect.any(String),
      'native-apple@example.com',
      'apple'
    );
  });
});

describe('UsersController.submitCancellationFeedback', () => {
  const buildFeedbackController = (insert: jest.Mock) => {
    const db = jest.fn().mockReturnValue({ insert });
    const controller = new UsersController(
      {} as UsersService,
      {} as AuthenticationService,
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

describe('UsersController.logOutEverywhere', () => {
  const buildLogOutEverywhereController = (logOutEverywhere: jest.Mock) => {
    const authService = {
      logOutEverywhere,
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      {} as UsersService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller };
  };

  const buildResWithLocals = (owner: number | null) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const clearCookie = jest.fn();
    return {
      json,
      status,
      clearCookie,
      locals: { owner },
    } as unknown as express.Response & {
      json: jest.Mock;
      status: jest.Mock;
      clearCookie: jest.Mock;
    };
  };

  it('revokes every session for the session owner and clears the cookie', async () => {
    const logOutEverywhere = jest.fn().mockResolvedValue(3);
    const { controller } = buildLogOutEverywhereController(logOutEverywhere);
    const req = {
      body: { owner: 999 },
    } as unknown as express.Request;
    const res = buildResWithLocals(7);
    const next = jest.fn();

    await controller.logOutEverywhere(req, res, next);

    expect(logOutEverywhere).toHaveBeenCalledWith(7);
    expect(logOutEverywhere).not.toHaveBeenCalledWith(999);
    expect(res.clearCookie).toHaveBeenCalledWith('token');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when there is no session owner and never revokes', async () => {
    const logOutEverywhere = jest.fn();
    const { controller } = buildLogOutEverywhereController(logOutEverywhere);
    const req = {} as express.Request;
    const res = buildResWithLocals(null);
    const next = jest.fn();

    await controller.logOutEverywhere(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(logOutEverywhere).not.toHaveBeenCalled();
  });
});

describe('UsersController.newPassword', () => {
  const buildNewPasswordController = (
    overrides: {
      getUserByLiveResetToken?: jest.Mock;
      updatePassword?: jest.Mock;
      logOutEverywhere?: jest.Mock;
    } = {}
  ) => {
    const getUserByLiveResetToken =
      overrides.getUserByLiveResetToken ??
      jest.fn().mockResolvedValue({ id: 7 });
    const updatePassword =
      overrides.updatePassword ?? jest.fn().mockResolvedValue(1);
    const logOutEverywhere =
      overrides.logOutEverywhere ?? jest.fn().mockResolvedValue(1);
    const userService = {
      getUserByLiveResetToken,
      updatePassword,
    } as unknown as UsersService;
    const authService = {
      isNewPasswordValid: jest.fn().mockReturnValue(false),
      getHashPassword: jest.fn().mockReturnValue('hashed'),
      logOutEverywhere,
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, updatePassword, logOutEverywhere };
  };

  const buildReq = () =>
    ({
      body: { reset_token: 'a-token', password: 'longenoughpw' },
      headers: {},
      ip: '203.0.113.9',
    }) as unknown as express.Request;

  const buildRes = () =>
    ({
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    }) as unknown as express.Response;

  it('revokes sessions only after the token is successfully redeemed', async () => {
    const { controller, logOutEverywhere } = buildNewPasswordController();
    const res = buildRes();

    await controller.newPassword(buildReq(), res, jest.fn());

    expect(logOutEverywhere).toHaveBeenCalledWith(7);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // A stale token must not stay usable as a way to force the owner out.
  it('never revokes sessions when the token no longer redeems', async () => {
    const { controller, logOutEverywhere } = buildNewPasswordController({
      getUserByLiveResetToken: jest.fn().mockResolvedValue(null),
      updatePassword: jest.fn().mockResolvedValue(0),
    });
    const res = buildRes();

    await controller.newPassword(buildReq(), res, jest.fn());

    expect(logOutEverywhere).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('does not revoke when the row is gone even if a redeem is reported', async () => {
    const { controller, logOutEverywhere } = buildNewPasswordController({
      getUserByLiveResetToken: jest.fn().mockResolvedValue(null),
    });
    const res = buildRes();

    await controller.newPassword(buildReq(), res, jest.fn());

    expect(logOutEverywhere).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
