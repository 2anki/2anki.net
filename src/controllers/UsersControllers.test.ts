import { vi, type Mock, type MockedClass } from 'vitest';
import express from 'express';

vi.mock('../lib/integrations/stripe', () => ({
  getStripe: vi.fn().mockReturnValue({
    customers: { retrieve: vi.fn() },
    subscriptions: {
      retrieve: vi.fn(),
      cancel: vi.fn(),
      update: vi.fn(),
    },
  }),
  updateStoreSubscription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/SubscriptionService', () => {
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
      cancelUserSubscriptions: vi.fn(),
      cancelSubscriptionById: vi.fn(),
      findRecentStripeSubscriptions: vi.fn(),
      countActiveByProductId: vi.fn().mockResolvedValue(0),
      getUserActiveSubscriptions: vi.fn().mockResolvedValue([]),
      pauseSubscription: vi.fn(),
      resumeSubscription: vi.fn(),
    },
  };
});

vi.mock('../lib/misc/hashToken', () => ({
  __esModule: true,
  default: vi.fn().mockReturnValue('hashed-token'),
}));

vi.mock('../services/events/track', () => ({ track: vi.fn() }));

const mockGetById = vi.fn().mockResolvedValue({ patreon: false });

vi.mock('../data_layer/UsersRepository', () => {
  return {
    __esModule: true,
    default: vi.fn().mockImplementation(function () {
      return {
        setSignupCountryIfMissing: vi.fn().mockResolvedValue(undefined),
        getSignupCountry: vi.fn().mockResolvedValue(null),
        getById: mockGetById,
        getCardUsage: vi.fn().mockResolvedValue({ cards_used: 0 }),
        getPrintUsage: vi
          .fn()
          .mockResolvedValue({ prints_used: 0, month_started_at: null }),
        updateName: vi.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

vi.mock('../data_layer/UserPassRepository', async () => {
  const actual = await vi.importActual<
    typeof import('../data_layer/UserPassRepository')
  >('../data_layer/UserPassRepository');
  return {
    ...actual,
    __esModule: true,
    default: vi.fn().mockImplementation(function () {
      return {
        findActive: vi.fn().mockResolvedValue(null),
      };
    }),
  };
});

import UsersController from './UsersControllers';
import UsersService, {
  MagicLinkRateLimitError,
  MagicLinkSuppressedError,
} from '../services/UsersService';
import AuthenticationService from '../services/AuthenticationService';
import SubscriptionService from '../services/SubscriptionService';
import OauthIdentitiesRepository from '../data_layer/OauthIdentitiesRepository';
import NotionRepository from '../data_layer/NotionRespository';
import { SESSION_MAX_AGE_MS } from '../shared/session';
import { track } from '../services/events/track';

const trackMock = track as Mock;

const SAMPLE_PW = '12345678';

const buildRes = () => {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const cookie = vi.fn();
  return { json, status, cookie } as unknown as express.Response & {
    json: Mock;
    status: Mock;
    cookie: Mock;
  };
};

const buildController = (overrides?: {
  getUserFrom?: Mock;
  register?: Mock;
  getHashPassword?: Mock;
  newJWTToken?: Mock;
  persistToken?: Mock;
  updateLastLoginAt?: Mock;
}) => {
  const mockUser = { id: 1, email: 'test@example.com' };
  const userService = {
    getUserFrom:
      overrides?.getUserFrom ??
      vi.fn().mockResolvedValueOnce(null).mockResolvedValue(mockUser),
    register: overrides?.register ?? vi.fn().mockResolvedValue([{ id: 1 }]),
    updateLastLoginAt:
      overrides?.updateLastLoginAt ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as UsersService;
  const authService = {
    getHashPassword:
      overrides?.getHashPassword ?? vi.fn().mockReturnValue('hashed'),
    newJWTToken: overrides?.newJWTToken ?? vi.fn().mockResolvedValue('jwt-tok'),
    persistToken:
      overrides?.persistToken ?? vi.fn().mockResolvedValue(undefined),
    isValidLogin: vi.fn().mockReturnValue(true),
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
    const register = vi.fn().mockResolvedValue([{ id: 1 }]);
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
    const next = vi.fn();

    await controller.register(req, res, next);

    expect(register).toHaveBeenCalledWith(
      '',
      'hashed',
      'jane.doe@example.com',
      '/notion-to-anki',
      expect.objectContaining({
        method: 'password',
        anonymousId: 'anon-abc-123',
      })
    );
  });

  it('emits signup_origin and signup_referrer from the first_touch cookie', async () => {
    const register = vi.fn().mockResolvedValue([{ id: 1 }]);
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
    const next = vi.fn();

    await controller.register(req, res, next);

    expect(register).toHaveBeenCalledWith(
      '',
      'hashed',
      'jane.doe@example.com',
      '/pdf-to-anki',
      expect.objectContaining({
        method: 'password',
        anonymousId: 'anon-abc-123',
        referrer: 'chatgpt.com',
      })
    );
  });

  it('prefers the first_touch cookie over the legacy source field', async () => {
    const register = vi.fn().mockResolvedValue([{ id: 1 }]);
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
    const next = vi.fn();

    await controller.register(req, res, next);

    expect(register).toHaveBeenCalledWith(
      '',
      'hashed',
      'jane.doe@example.com',
      '/markdown-to-anki',
      expect.objectContaining({ method: 'password', anonymousId: null })
    );
  });

  it('emits account_created with a null anonymous id when no anon_id cookie is present', async () => {
    const register = vi.fn().mockResolvedValue([{ id: 1 }]);
    const { controller } = buildController({ register });
    const req = {
      body: { email: 'jane.doe@example.com', password: SAMPLE_PW },
      query: {},
      cookies: {},
    } as unknown as express.Request;
    const res = buildRes();
    const next = vi.fn();

    await controller.register(req, res, next);

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      null,
      expect.objectContaining({ method: 'password', anonymousId: null })
    );
  });

  it('does not emit account_created when the email is already registered', async () => {
    const getUserFrom = vi
      .fn()
      .mockResolvedValue({ id: 1, email: 'taken@example.com' });
    const register = vi.fn();
    const { controller } = buildController({ getUserFrom, register });
    const req = {
      body: { email: 'taken@example.com', password: SAMPLE_PW },
      cookies: { anon_id: 'anon-abc-123' },
    } as unknown as express.Request;
    const res = buildRes();
    const next = vi.fn();

    await controller.register(req, res, next);

    expect(trackMock).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('rejects requests missing both email and password with 400', async () => {
    const { controller } = buildController();
    const req = { body: {} } as express.Request;
    const res = buildRes();
    const next = vi.fn();

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
    const next = vi.fn();

    await controller.register(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('auto-logs in the user after registration and sets a JWT cookie', async () => {
    const register = vi.fn().mockResolvedValue([{ id: 1 }]);
    const newJWTToken = vi.fn().mockResolvedValue('jwt-reg-tok');
    const persistToken = vi.fn().mockResolvedValue(undefined);
    const updateLastLoginAt = vi.fn().mockResolvedValue(undefined);
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
    const next = vi.fn();

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
    const register = vi.fn().mockResolvedValue([{ id: 1 }]);
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
    const next = vi.fn();

    await controller.register(req, res, next);

    expect(register).toHaveBeenCalledWith(
      'Alex',
      'hashed',
      'alex@example.com',
      null,
      expect.objectContaining({ method: 'password' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('persists signup_origin when source matches an allowed landing path', async () => {
    const register = vi.fn().mockResolvedValue([{ id: 1 }]);
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
    const next = vi.fn();

    await controller.register(req, res, next);

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      'hashed',
      'al@example.com',
      '/notion-to-anki',
      expect.objectContaining({ method: 'password' })
    );
  });

  it('drops the signup_origin to null when source fails the allowlist regex', async () => {
    const register = vi.fn().mockResolvedValue([{ id: 1 }]);
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
    const next = vi.fn();

    await controller.register(req, res, next);

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      'hashed',
      'al@example.com',
      null,
      expect.objectContaining({ method: 'password' })
    );
  });

  it('returns 400 when the email is already registered', async () => {
    const getUserFrom = vi
      .fn()
      .mockResolvedValue({ id: 1, email: 'taken@example.com' });
    const register = vi.fn();
    const { controller } = buildController({ getUserFrom, register });
    const req = {
      body: { email: 'taken@example.com', password: SAMPLE_PW },
    } as express.Request;
    const res = buildRes();
    const next = vi.fn();

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
    verifyMagicToken?: Mock;
    markEmailVerified?: Mock;
    authGetUserFrom?: Mock;
  }) => {
    const userService = {
      verifyMagicToken:
        overrides?.verifyMagicToken ?? vi.fn().mockResolvedValue(null),
      markEmailVerified:
        overrides?.markEmailVerified ?? vi.fn().mockResolvedValue(1),
    } as unknown as UsersService;
    const authService = {
      getUserFrom:
        overrides?.authGetUserFrom ?? vi.fn().mockResolvedValue(null),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, userService };
  };

  const buildVerifyEmailRes = () => {
    const redirect = vi.fn();
    return { redirect } as unknown as express.Response & {
      redirect: Mock;
    };
  };

  it('redirects to /login?verified=1 when the verify_email token is valid and user is unauthenticated', async () => {
    const verifyMagicToken = vi
      .fn()
      .mockResolvedValue({ userId: 7, purpose: 'verify_email' });
    const markEmailVerified = vi.fn().mockResolvedValue(1);
    const { controller } = buildVerifyEmailController({
      verifyMagicToken,
      markEmailVerified,
    });
    const req = {
      params: { token: 'valid-verify-tok' },
      cookies: {},
    } as unknown as express.Request;
    const res = buildVerifyEmailRes();
    const next = vi.fn();

    await controller.verifyEmail(req, res, next);

    expect(markEmailVerified).toHaveBeenCalledWith('7');
    expect(res.redirect).toHaveBeenCalledWith('/login?verified=1');
  });

  it('redirects to /account?verified=1 when the token is valid and user is authenticated', async () => {
    const verifyMagicToken = vi
      .fn()
      .mockResolvedValue({ userId: 7, purpose: 'verify_email' });
    const markEmailVerified = vi.fn().mockResolvedValue(1);
    const authGetUserFrom = vi.fn().mockResolvedValue({ id: 7 });
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
    const next = vi.fn();

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
    const next = vi.fn();

    await controller.verifyEmail(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/login?verify_error=expired');
  });

  it('redirects to /account?verify_error=expired when token is invalid and user is authenticated', async () => {
    const authGetUserFrom = vi.fn().mockResolvedValue({ id: 7 });
    const { controller } = buildVerifyEmailController({ authGetUserFrom });
    const req = {
      params: { token: 'bad-tok' },
      cookies: { token: 'session' },
    } as unknown as express.Request;
    const res = buildVerifyEmailRes();
    const next = vi.fn();

    await controller.verifyEmail(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/account?verify_error=expired');
  });

  it('redirects to /login?verify_error=expired for non-verify_email purpose tokens when unauthenticated', async () => {
    const verifyMagicToken = vi
      .fn()
      .mockResolvedValue({ userId: 7, purpose: 'login' });
    const { controller } = buildVerifyEmailController({ verifyMagicToken });
    const req = {
      params: { token: 'login-tok' },
      cookies: {},
    } as unknown as express.Request;
    const res = buildVerifyEmailRes();
    const next = vi.fn();

    await controller.verifyEmail(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/login?verify_error=expired');
  });

  it('logs the error and forwards it to next() when verification throws', async () => {
    const dbError = new Error('Database connection failed');
    const verifyMagicToken = vi.fn().mockRejectedValue(dbError);
    const { controller } = buildVerifyEmailController({ verifyMagicToken });
    const req = {
      params: { token: 'valid-tok' },
      cookies: {},
    } as unknown as express.Request;
    const res = buildVerifyEmailRes();
    const next = vi.fn();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

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
  const buildMagicController = (overrides?: { requestMagicLink?: Mock }) => {
    const userService = {
      requestMagicLink:
        overrides?.requestMagicLink ?? vi.fn().mockResolvedValue(undefined),
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
    const next = vi.fn();

    await controller.requestMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'ok' });
  });

  it('defaults purpose to login when not provided', async () => {
    const requestMagicLink = vi.fn().mockResolvedValue(undefined);
    const { controller } = buildMagicController({ requestMagicLink });
    const req = {
      body: { email: 'al@example.com' },
    } as express.Request;
    const res = buildRes();
    const next = vi.fn();

    await controller.requestMagicLink(req, res, next);

    expect(requestMagicLink).toHaveBeenCalledWith(
      'al@example.com',
      'login',
      null,
      undefined,
      expect.objectContaining({ anonymousId: null })
    );
  });

  it('forwards a validated relative redirect to the service', async () => {
    const requestMagicLink = vi.fn().mockResolvedValue(undefined);
    const { controller } = buildMagicController({ requestMagicLink });
    const req = {
      body: { email: 'al@example.com', purpose: 'login', redirect: '/upload' },
    } as express.Request;
    const res = buildRes();
    const next = vi.fn();

    await controller.requestMagicLink(req, res, next);

    expect(requestMagicLink).toHaveBeenCalledWith(
      'al@example.com',
      'login',
      null,
      '/upload',
      expect.objectContaining({ anonymousId: null })
    );
  });

  it('drops an unsafe redirect before calling the service', async () => {
    const requestMagicLink = vi.fn().mockResolvedValue(undefined);
    const { controller } = buildMagicController({ requestMagicLink });
    const req = {
      body: {
        email: 'al@example.com',
        purpose: 'login',
        redirect: 'https://evil.example',
      },
    } as express.Request;
    const res = buildRes();
    const next = vi.fn();

    await controller.requestMagicLink(req, res, next);

    expect(requestMagicLink).toHaveBeenCalledWith(
      'al@example.com',
      'login',
      null,
      undefined,
      expect.objectContaining({ anonymousId: null })
    );
  });

  it('returns 400 when email is missing', async () => {
    const { controller } = buildMagicController();
    const req = { body: { purpose: 'login' } } as express.Request;
    const res = buildRes();
    const next = vi.fn();

    await controller.requestMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for an invalid purpose', async () => {
    const { controller } = buildMagicController();
    const req = {
      body: { email: 'al@example.com', purpose: 'evil' },
    } as express.Request;
    const res = buildRes();
    const next = vi.fn();

    await controller.requestMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid purpose' });
  });

  it('returns 200 even when rate limited to prevent email enumeration', async () => {
    const requestMagicLink = vi
      .fn()
      .mockRejectedValue(new MagicLinkRateLimitError());
    const { controller } = buildMagicController({ requestMagicLink });
    const req = {
      body: { email: 'al@example.com', purpose: 'login' },
    } as express.Request;
    const res = buildRes();
    const next = vi.fn();

    await controller.requestMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 200 with suppressed flag when the address is on the suppression list', async () => {
    const requestMagicLink = vi
      .fn()
      .mockRejectedValue(new MagicLinkSuppressedError());
    const { controller } = buildMagicController({ requestMagicLink });
    const req = {
      body: { email: 'blocked@example.com', purpose: 'login' },
    } as express.Request;
    const res = buildRes();
    const next = vi.fn();

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
    const requestMagicLink = vi.fn().mockRejectedValue(sendgridError);
    const { controller } = buildMagicController({ requestMagicLink });
    const req = {
      body: { email: 'al@example.com', purpose: 'login' },
    } as express.Request;
    const res = buildRes();
    const next = vi.fn();

    await controller.requestMagicLink(req, res, next);

    expect(next).toHaveBeenCalledWith(sendgridError);
    expect(res.status).not.toHaveBeenCalledWith(200);
  });
});

describe('UsersController.verifyMagicLink', () => {
  const buildVerifyController = (overrides?: {
    verifyMagicToken?: Mock;
    getUserById?: Mock;
    newJWTToken?: Mock;
    persistToken?: Mock;
    updateLastLoginAt?: Mock;
    markEmailVerified?: Mock;
  }) => {
    const userService = {
      verifyMagicToken:
        overrides?.verifyMagicToken ?? vi.fn().mockResolvedValue(null),
      getUserById:
        overrides?.getUserById ??
        vi.fn().mockResolvedValue({ id: 1, email: 'al@example.com' }),
      updateLastLoginAt:
        overrides?.updateLastLoginAt ?? vi.fn().mockResolvedValue(undefined),
      markEmailVerified:
        overrides?.markEmailVerified ?? vi.fn().mockResolvedValue(1),
    } as unknown as UsersService;
    const authService = {
      newJWTToken:
        overrides?.newJWTToken ?? vi.fn().mockResolvedValue('jwt-token-abc'),
      persistToken:
        overrides?.persistToken ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, userService, authService };
  };

  const buildVerifyRes = () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const cookie = vi.fn();
    return { json, status, cookie } as unknown as express.Response & {
      json: Mock;
      status: Mock;
      cookie: Mock;
    };
  };

  it('returns 400 for an invalid token', async () => {
    const { controller } = buildVerifyController();
    const req = {
      params: { token: 'bad-token' },
    } as unknown as express.Request;
    const res = buildVerifyRes();
    const next = vi.fn();

    await controller.verifyMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'This link is invalid or has expired.',
    });
  });

  it('sets a JWT cookie and returns the token for a login purpose', async () => {
    const verifyMagicToken = vi
      .fn()
      .mockResolvedValue({ userId: 5, purpose: 'login' });
    const newJWTToken = vi.fn().mockResolvedValue('jwt-login-tok');
    const persistToken = vi.fn().mockResolvedValue(undefined);
    const updateLastLoginAt = vi.fn().mockResolvedValue(undefined);
    const getUserById = vi
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
    const next = vi.fn();

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
    const verifyMagicToken = vi
      .fn()
      .mockResolvedValue({ userId: 8, purpose: 'password_reset' });
    const getUserById = vi
      .fn()
      .mockResolvedValue({ id: 8, email: 'reset@example.com' });
    const updateResetToken = vi.fn().mockResolvedValue(undefined);
    const userService = {
      verifyMagicToken,
      getUserById,
      updateResetToken,
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
      markEmailVerified: vi.fn().mockResolvedValue(1),
    } as unknown as UsersService;
    const authService = {
      newJWTToken: vi.fn().mockResolvedValue('jwt-tok'),
      persistToken: vi.fn().mockResolvedValue(undefined),
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
    const next = vi.fn();

    await controller.verifyMagicLink(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.purpose).toBe('password_reset');
    expect(typeof jsonCall.reset_token).toBe('string');
    expect(jsonCall.reset_token.length).toBeGreaterThan(0);
    expect(updateResetToken).toHaveBeenCalledWith('8', jsonCall.reset_token);
  });

  it('marks email verified after a successful login magic link', async () => {
    const verifyMagicToken = vi
      .fn()
      .mockResolvedValue({ userId: 5, purpose: 'login' });
    const getUserById = vi
      .fn()
      .mockResolvedValue({ id: 5, email: 'al@example.com' });
    const markEmailVerified = vi.fn().mockResolvedValue(1);
    const { controller } = buildVerifyController({
      verifyMagicToken,
      getUserById,
      markEmailVerified,
    });
    const req = {
      params: { token: 'valid-tok' },
    } as unknown as express.Request;
    const res = buildVerifyRes();
    const next = vi.fn();

    await controller.verifyMagicLink(req, res, next);

    expect(markEmailVerified).toHaveBeenCalledWith('5');
  });

  it('marks email verified after a successful password_reset magic link', async () => {
    const verifyMagicToken = vi
      .fn()
      .mockResolvedValue({ userId: 8, purpose: 'password_reset' });
    const getUserById = vi
      .fn()
      .mockResolvedValue({ id: 8, email: 'reset@example.com' });
    const markEmailVerified = vi.fn().mockResolvedValue(1);
    const updateResetToken = vi.fn().mockResolvedValue(undefined);
    const userService = {
      verifyMagicToken,
      getUserById,
      updateResetToken,
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
      markEmailVerified,
    } as unknown as UsersService;
    const authService = {
      newJWTToken: vi.fn().mockResolvedValue('jwt-tok'),
      persistToken: vi.fn().mockResolvedValue(undefined),
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
    const next = vi.fn();

    await controller.verifyMagicLink(req, res, next);

    expect(markEmailVerified).toHaveBeenCalledWith('8');
  });

  it('echoes a validated relative redirect for a login token', async () => {
    const verifyMagicToken = vi
      .fn()
      .mockResolvedValue({ userId: 5, purpose: 'login' });
    const getUserById = vi
      .fn()
      .mockResolvedValue({ id: 5, email: 'al@example.com' });
    const { controller } = buildVerifyController({
      verifyMagicToken,
      getUserById,
      newJWTToken: vi.fn().mockResolvedValue('jwt-login-tok'),
    });
    const req = {
      params: { token: 'valid-tok' },
      query: { redirect: '/upload' },
    } as unknown as express.Request;
    const res = buildVerifyRes();
    const next = vi.fn();

    await controller.verifyMagicLink(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      token: 'jwt-login-tok',
      redirect: '/upload',
    });
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil'])(
    'drops the unsafe redirect %s and returns only the token',
    async (unsafe) => {
      const verifyMagicToken = vi
        .fn()
        .mockResolvedValue({ userId: 5, purpose: 'login' });
      const getUserById = vi
        .fn()
        .mockResolvedValue({ id: 5, email: 'al@example.com' });
      const { controller } = buildVerifyController({
        verifyMagicToken,
        getUserById,
        newJWTToken: vi.fn().mockResolvedValue('jwt-login-tok'),
      });
      const req = {
        params: { token: 'valid-tok' },
        query: { redirect: unsafe },
      } as unknown as express.Request;
      const res = buildVerifyRes();
      const next = vi.fn();

      await controller.verifyMagicLink(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ token: 'jwt-login-tok' });
    }
  );
});

describe('UsersController.loginWithGoogle', () => {
  const buildGoogleController = (overrides?: {
    getUserFrom?: Mock;
    registerVerifiedIdentity?: Mock;
    markEmailVerified?: Mock;
    newJWTToken?: Mock;
    persistToken?: Mock;
    updateLastLoginAt?: Mock;
    loginWithGoogle?: Mock;
  }) => {
    const mockUser = { id: 7, email: 'g@example.com' };
    const userService = {
      getUserFrom:
        overrides?.getUserFrom ??
        vi.fn().mockResolvedValueOnce(null).mockResolvedValue(mockUser),
      registerVerifiedIdentity:
        overrides?.registerVerifiedIdentity ??
        vi.fn().mockResolvedValue([{ id: 7 }]),
      markEmailVerified:
        overrides?.markEmailVerified ?? vi.fn().mockResolvedValue(1),
      updateLastLoginAt:
        overrides?.updateLastLoginAt ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithGoogle:
        overrides?.loginWithGoogle ??
        vi.fn().mockResolvedValue({
          ok: true,
          email: 'g@example.com',
          name: 'Google User',
        }),
      getHashPassword: vi.fn().mockReturnValue('hashed'),
      newJWTToken:
        overrides?.newJWTToken ?? vi.fn().mockResolvedValue('google-jwt'),
      persistToken:
        overrides?.persistToken ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, userService, authService };
  };

  const buildGoogleRes = () => {
    const redirect = vi.fn();
    const cookie = vi.fn();
    const status = vi.fn().mockReturnThis();
    return { redirect, cookie, status } as unknown as express.Response & {
      redirect: Mock;
      cookie: Mock;
      status: Mock;
    };
  };

  it("registers new Google users with signup_origin set to 'google'", async () => {
    const register = vi.fn().mockResolvedValue([{ id: 7 }]);
    const { controller } = buildGoogleController({
      registerVerifiedIdentity: register,
    });
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
      'google',
      expect.objectContaining({ method: 'google' })
    );
  });

  it('does not call register for an existing Google user', async () => {
    const existingUser = { id: 9, email: 'existing@example.com' };
    const getUserFrom = vi.fn().mockResolvedValue(existingUser);
    const register = vi.fn();
    const { controller } = buildGoogleController({
      getUserFrom,
      registerVerifiedIdentity: register,
    });
    const req = {
      query: { code: 'gauth-code' },
      cookies: {},
      headers: {},
    } as unknown as express.Request;
    const res = buildGoogleRes();

    await controller.loginWithGoogle(req, res);

    expect(register).not.toHaveBeenCalled();
  });

  it('records a Google sign-in onto an existing unverified account', async () => {
    trackMock.mockClear();
    const getUserFrom = vi.fn().mockResolvedValue({
      id: 9,
      email: 'existing@example.com',
      email_verified: false,
      created_at: new Date('2025-01-01T00:00:00.000Z'),
    });
    const { controller } = buildGoogleController({ getUserFrom });
    const req = {
      query: { code: 'gauth-code' },
      cookies: {},
      headers: {},
    } as unknown as express.Request;

    await controller.loginWithGoogle(req, buildGoogleRes());

    expect(trackMock).toHaveBeenCalledWith('unverified_account_signin', {
      userId: 9,
      props: { surface: 'google', account_age: 'over_30d' },
    });
  });

  it('does not record a Google sign-in that creates the account', async () => {
    trackMock.mockClear();
    const { controller } = buildGoogleController();
    const req = {
      query: { code: 'gauth-code' },
      cookies: {},
      headers: {},
    } as unknown as express.Request;

    await controller.loginWithGoogle(req, buildGoogleRes());

    expect(
      trackMock.mock.calls.filter(
        ([name]) => name === 'unverified_account_signin'
      )
    ).toHaveLength(0);
  });

  it('redirects with error=google_signin_failed when the token exchange fails', async () => {
    const loginWithGoogle = vi.fn().mockResolvedValue({
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

vi.mock('../data_layer/OauthIdentitiesRepository');
vi.mock('../data_layer/NotionRespository');

describe('UsersController.loginWithMicrosoft', () => {
  const MockedOauthIdentitiesRepo = OauthIdentitiesRepository as MockedClass<
    typeof OauthIdentitiesRepository
  >;

  beforeEach(() => {
    MockedOauthIdentitiesRepo.mockClear();
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = vi
      .fn()
      .mockResolvedValue(null);
    MockedOauthIdentitiesRepo.prototype.link = vi
      .fn()
      .mockResolvedValue(undefined);
  });

  const buildMicrosoftController = (overrides?: {
    getUserFrom?: Mock;
    getUserById?: Mock;
    registerVerifiedIdentity?: Mock;
    markEmailVerified?: Mock;
    newJWTToken?: Mock;
    persistToken?: Mock;
    updateLastLoginAt?: Mock;
    loginWithMicrosoft?: Mock;
  }) => {
    const mockUser = { id: 11, email: 'm@example.com' };
    const userService = {
      getUserFrom:
        overrides?.getUserFrom ??
        vi.fn().mockResolvedValueOnce(null).mockResolvedValue(mockUser),
      getUserById:
        overrides?.getUserById ?? vi.fn().mockResolvedValue(mockUser),
      registerVerifiedIdentity:
        overrides?.registerVerifiedIdentity ??
        vi.fn().mockResolvedValue([{ id: 11 }]),
      markEmailVerified:
        overrides?.markEmailVerified ?? vi.fn().mockResolvedValue(1),
      updateLastLoginAt:
        overrides?.updateLastLoginAt ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithMicrosoft:
        overrides?.loginWithMicrosoft ??
        vi.fn().mockResolvedValue({
          subject: 'ms-sub-001',
          email: 'm@example.com',
          name: 'Microsoft User',
          emailVerified: true,
        }),
      getHashPassword: vi.fn().mockReturnValue('hashed'),
      newJWTToken:
        overrides?.newJWTToken ?? vi.fn().mockResolvedValue('microsoft-jwt'),
      persistToken:
        overrides?.persistToken ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, userService, authService };
  };

  const buildMicrosoftRes = () => {
    const redirect = vi.fn();
    const cookie = vi.fn();
    const status = vi.fn().mockReturnThis();
    return { redirect, cookie, status } as unknown as express.Response & {
      redirect: Mock;
      cookie: Mock;
      status: Mock;
    };
  };

  const buildReq = (code: string | null = 'mauth-code') =>
    ({
      query: code == null ? {} : { code },
      cookies: {},
      headers: {},
    }) as unknown as express.Request;

  it("creates a new user, links the identity, and stamps signup_origin='microsoft' when the verified email has no existing account", async () => {
    const register = vi.fn().mockResolvedValue([{ id: 11 }]);
    const { controller } = buildMicrosoftController({
      registerVerifiedIdentity: register,
    });

    await controller.loginWithMicrosoft(buildReq(), buildMicrosoftRes());

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'm@example.com',
      'microsoft',
      expect.objectContaining({ method: 'microsoft' })
    );
    expect(MockedOauthIdentitiesRepo.prototype.link).toHaveBeenCalledWith(
      'microsoft',
      'ms-sub-001',
      11
    );
  });

  it('signs in via subject lookup without calling register or re-linking when the identity already exists', async () => {
    const register = vi.fn();
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = vi
      .fn()
      .mockResolvedValue({
        user_id: 42,
        provider: 'microsoft',
        subject: 'ms-sub-001',
      });
    const getUserById = vi
      .fn()
      .mockResolvedValue({ id: 42, email: 'returner@outlook.com' });

    const { controller } = buildMicrosoftController({
      registerVerifiedIdentity: register,
      getUserById,
    });

    await controller.loginWithMicrosoft(buildReq(), buildMicrosoftRes());

    expect(getUserById).toHaveBeenCalledWith('42');
    expect(register).not.toHaveBeenCalled();
    expect(MockedOauthIdentitiesRepo.prototype.link).not.toHaveBeenCalled();
  });

  it('links the identity to the existing user when verified email matches but no identity row exists yet', async () => {
    const existingUser = { id: 13, email: 'existing@outlook.com' };
    const getUserFrom = vi.fn().mockResolvedValue(existingUser);
    const register = vi.fn();

    const { controller } = buildMicrosoftController({
      getUserFrom,
      registerVerifiedIdentity: register,
    });

    await controller.loginWithMicrosoft(buildReq(), buildMicrosoftRes());

    expect(register).not.toHaveBeenCalled();
    expect(MockedOauthIdentitiesRepo.prototype.link).toHaveBeenCalledWith(
      'microsoft',
      'ms-sub-001',
      13
    );
  });

  const microsoftRedirectCases: Array<
    [
      string,
      () => Parameters<typeof buildMicrosoftController>[0],
      string | null,
      (register: Mock) => void,
    ]
  > = [
    [
      'the email is not verified',
      () => ({
        loginWithMicrosoft: vi.fn().mockResolvedValue({
          subject: 'ms-sub-002',
          email: 'unverified@example.com',
          name: 'Unverified',
          emailVerified: false,
        }),
      }),
      'mauth-code',
      (register) => {
        expect(register).not.toHaveBeenCalled();
        expect(MockedOauthIdentitiesRepo.prototype.link).not.toHaveBeenCalled();
      },
    ],
    [
      'the email claim is missing and no identity exists',
      () => ({
        loginWithMicrosoft: vi.fn().mockResolvedValue({
          subject: 'ms-sub-003',
          email: undefined,
          name: 'No Email',
          emailVerified: true,
        }),
      }),
      'mauth-code',
      (register) => {
        expect(register).not.toHaveBeenCalled();
      },
    ],
    ['the OAuth code is missing', () => undefined, null, () => {}],
    [
      'the token exchange fails',
      () => ({ loginWithMicrosoft: vi.fn().mockResolvedValue(undefined) }),
      'bad-code',
      () => {},
    ],
  ];

  it.each(microsoftRedirectCases)(
    'redirects to /login when %s',
    async (_label, makeOverrides, code, assertExtra) => {
      const register = vi.fn();
      const { controller } = buildMicrosoftController({
        ...makeOverrides(),
        registerVerifiedIdentity: register,
      });
      const res = buildMicrosoftRes();

      await controller.loginWithMicrosoft(buildReq(code), res);

      expect(res.redirect).toHaveBeenCalledWith(
        '/login?error=microsoft_signin_failed'
      );
      assertExtra(register);
    }
  );
});

describe('UsersController.loginWithApple', () => {
  const MockedOauthIdentitiesRepo = OauthIdentitiesRepository as MockedClass<
    typeof OauthIdentitiesRepository
  >;

  beforeEach(() => {
    MockedOauthIdentitiesRepo.mockClear();
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = vi
      .fn()
      .mockResolvedValue(null);
    MockedOauthIdentitiesRepo.prototype.link = vi
      .fn()
      .mockResolvedValue(undefined);
    MockedOauthIdentitiesRepo.prototype.updateRefreshToken = vi
      .fn()
      .mockResolvedValue(undefined);
  });

  const buildAppleController = (overrides?: {
    getUserFrom?: Mock;
    getUserById?: Mock;
    registerVerifiedIdentity?: Mock;
    markEmailVerified?: Mock;
    newJWTToken?: Mock;
    persistToken?: Mock;
    updateLastLoginAt?: Mock;
    loginWithApple?: Mock;
  }) => {
    const mockUser = { id: 20, email: 'apple@example.com' };
    const userService = {
      getUserFrom:
        overrides?.getUserFrom ??
        vi.fn().mockResolvedValueOnce(null).mockResolvedValue(mockUser),
      getUserById:
        overrides?.getUserById ?? vi.fn().mockResolvedValue(mockUser),
      registerVerifiedIdentity:
        overrides?.registerVerifiedIdentity ??
        vi.fn().mockResolvedValue([{ id: 20 }]),
      markEmailVerified:
        overrides?.markEmailVerified ?? vi.fn().mockResolvedValue(1),
      updateLastLoginAt:
        overrides?.updateLastLoginAt ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithApple:
        overrides?.loginWithApple ??
        vi.fn().mockResolvedValue({
          ok: true,
          subject: 'apple-sub-001',
          email: 'apple@example.com',
          emailVerified: true,
        }),
      getHashPassword: vi.fn().mockReturnValue('hashed'),
      newJWTToken:
        overrides?.newJWTToken ?? vi.fn().mockResolvedValue('apple-jwt'),
      persistToken:
        overrides?.persistToken ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, userService, authService };
  };

  const buildAppleRes = () => {
    const redirect = vi.fn();
    const cookie = vi.fn();
    const clearCookie = vi.fn();
    const status = vi.fn().mockReturnThis();
    return {
      redirect,
      cookie,
      clearCookie,
      status,
    } as unknown as express.Response & {
      redirect: Mock;
      cookie: Mock;
      clearCookie: Mock;
      status: Mock;
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
    const register = vi.fn().mockResolvedValue([{ id: 20 }]);
    const { controller } = buildAppleController({
      registerVerifiedIdentity: register,
    });

    await controller.loginWithApple(buildReq(), buildAppleRes());

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'apple@example.com',
      'apple',
      expect.objectContaining({ method: 'apple' })
    );
    expect(MockedOauthIdentitiesRepo.prototype.link).toHaveBeenCalledWith(
      'apple',
      'apple-sub-001',
      20,
      undefined
    );
  });

  it('stores the Apple refresh token on the linked identity when present', async () => {
    const register = vi.fn().mockResolvedValue([{ id: 20 }]);
    const loginWithApple = vi.fn().mockResolvedValue({
      ok: true,
      subject: 'apple-sub-001',
      email: 'apple@example.com',
      emailVerified: true,
      refreshToken: 'apple-refresh-555',
    });
    const { controller } = buildAppleController({
      registerVerifiedIdentity: register,
      loginWithApple,
    });

    await controller.loginWithApple(buildReq(), buildAppleRes());

    expect(MockedOauthIdentitiesRepo.prototype.link).toHaveBeenCalledWith(
      'apple',
      'apple-sub-001',
      20,
      'apple-refresh-555'
    );
  });

  it('refreshes the stored token when the identity already exists', async () => {
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = vi
      .fn()
      .mockResolvedValue({
        user_id: 20,
        provider: 'apple',
        subject: 'apple-sub-001',
      });
    MockedOauthIdentitiesRepo.prototype.updateRefreshToken = vi
      .fn()
      .mockResolvedValue(undefined);
    const getUserById = vi
      .fn()
      .mockResolvedValue({ id: 20, email: 'apple@example.com' });
    const loginWithApple = vi.fn().mockResolvedValue({
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
    const register = vi.fn();
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = vi
      .fn()
      .mockResolvedValue({
        user_id: 20,
        provider: 'apple',
        subject: 'apple-sub-001',
      });
    const getUserById = vi
      .fn()
      .mockResolvedValue({ id: 20, email: 'apple@example.com' });

    const { controller } = buildAppleController({
      registerVerifiedIdentity: register,
      getUserById,
    });

    await controller.loginWithApple(buildReq(), buildAppleRes());

    expect(getUserById).toHaveBeenCalledWith('20');
    expect(register).not.toHaveBeenCalled();
    expect(MockedOauthIdentitiesRepo.prototype.link).not.toHaveBeenCalled();
  });

  it('links the identity to the existing user when email matches but no identity row exists yet', async () => {
    const existingUser = { id: 21, email: 'existing@example.com' };
    const getUserFrom = vi.fn().mockResolvedValue(existingUser);
    const register = vi.fn();

    const { controller } = buildAppleController({
      getUserFrom,
      registerVerifiedIdentity: register,
    });

    await controller.loginWithApple(buildReq(), buildAppleRes());

    expect(register).not.toHaveBeenCalled();
    expect(MockedOauthIdentitiesRepo.prototype.link).toHaveBeenCalledWith(
      'apple',
      'apple-sub-001',
      21,
      undefined
    );
  });

  const appleRedirectCases: Array<
    [
      string,
      () => Parameters<typeof buildAppleController>[0],
      Parameters<typeof buildReq>[0],
    ]
  > = [
    ['the state cookie is missing', () => undefined, { stateCookie: '' }],
    [
      'the state parameter does not match the cookie',
      () => undefined,
      { state: 'tampered', stateCookie: 'valid-state-token' },
    ],
    ['the code is absent', () => undefined, { code: null }],
    [
      'the token exchange fails',
      () => ({
        loginWithApple: vi.fn().mockResolvedValue({
          ok: false,
          reason: 'token_exchange_failed',
          message: 'HTTP 400 invalid_grant',
        }),
      }),
      undefined,
    ],
    [
      'email is missing and no identity exists',
      () => ({
        loginWithApple: vi.fn().mockResolvedValue({
          ok: true,
          subject: 'apple-sub-noemail',
          email: undefined,
          emailVerified: true,
        }),
      }),
      undefined,
    ],
  ];

  it.each(appleRedirectCases)(
    'redirects to /login when %s',
    async (_label, makeOverrides, reqOpts) => {
      const { controller } = buildAppleController(makeOverrides());
      const res = buildAppleRes();

      await controller.loginWithApple(buildReq(reqOpts), res);

      expect(res.redirect).toHaveBeenCalledWith('/login');
    }
  );
});

describe('UsersController.deleteAccount — Apple token revocation', () => {
  const MockedOauthIdentitiesRepo = OauthIdentitiesRepository as MockedClass<
    typeof OauthIdentitiesRepository
  >;
  const SubscriptionServiceMock = SubscriptionService as unknown as {
    cancelUserSubscriptions: Mock;
  };

  beforeEach(() => {
    MockedOauthIdentitiesRepo.mockClear();
    SubscriptionServiceMock.cancelUserSubscriptions = vi
      .fn()
      .mockResolvedValue(undefined);
  });

  const buildDeleteController = (overrides?: {
    refreshToken?: string | null;
    revokeAppleToken?: Mock;
    deleteUser?: Mock;
  }) => {
    MockedOauthIdentitiesRepo.prototype.findRefreshTokenByUserAndProvider = vi
      .fn()
      .mockResolvedValue(overrides?.refreshToken ?? null);
    const deleteUser =
      overrides?.deleteUser ?? vi.fn().mockResolvedValue(undefined);
    const userService = {
      getUserById: vi
        .fn()
        .mockResolvedValue({ id: 42, email: 'apple@example.com' }),
      deleteUser,
    } as unknown as UsersService;
    const authService = {
      revokeAppleToken:
        overrides?.revokeAppleToken ?? vi.fn().mockResolvedValue(true),
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
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return { json, status } as unknown as express.Response & {
      json: Mock;
      status: Mock;
    };
  };

  it('revokes the stored Apple refresh token before deleting the user', async () => {
    const revokeAppleToken = vi.fn().mockResolvedValue(true);
    const deleteUser = vi.fn().mockResolvedValue(undefined);
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
    const revokeAppleToken = vi.fn();
    const deleteUser = vi.fn().mockResolvedValue(undefined);
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
    const revokeAppleToken = vi
      .fn()
      .mockRejectedValue(new Error('apple revoke down'));
    const deleteUser = vi.fn().mockResolvedValue(undefined);
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
    SubscriptionServiceMock.cancelUserSubscriptions = vi
      .fn()
      .mockRejectedValue(new Error('stripe down'));
    const deleteUser = vi.fn().mockResolvedValue(undefined);
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
  const MockedNotionRepo = NotionRepository as MockedClass<
    typeof NotionRepository
  >;

  beforeEach(() => {
    MockedNotionRepo.mockClear();
    MockedNotionRepo.prototype.getNotionData = vi.fn().mockResolvedValue(null);
  });

  const buildLoginController = (overrides?: {
    comparePassword?: Mock;
    newJWTToken?: Mock;
    persistToken?: Mock;
  }) => {
    const mockUser = { id: 5, email: 'u@example.com', pw: 'mock' };
    const userService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      isValidLogin: vi.fn().mockReturnValue(true),
      comparePassword:
        overrides?.comparePassword ?? vi.fn().mockReturnValue(true),
      newJWTToken:
        overrides?.newJWTToken ?? vi.fn().mockResolvedValue('login-jwt'),
      persistToken:
        overrides?.persistToken ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller };
  };

  const buildLoginRes = () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const cookie = vi.fn();
    return { json, status, cookie } as unknown as express.Response & {
      json: Mock;
      status: Mock;
      cookie: Mock;
    };
  };

  it('redirects to /upload when user has no Notion token and no redirect param', async () => {
    MockedNotionRepo.prototype.getNotionData = vi.fn().mockResolvedValue(null);
    const { controller } = buildLoginController();
    const req = {
      body: { email: 'u@example.com', credentials: 'mock' },
      query: {},
    } as unknown as express.Request;
    const res = buildLoginRes();
    const next = vi.fn();

    await controller.login(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.redirect).toBe('/upload');
  });

  it('redirects to /notion when user has a Notion token and no redirect param', async () => {
    MockedNotionRepo.prototype.getNotionData = vi
      .fn()
      .mockResolvedValue({ token: 'stored-tok', owner: 5 });
    const { controller } = buildLoginController();
    const req = {
      body: { email: 'u@example.com', credentials: 'mock' },
      query: {},
    } as unknown as express.Request;
    const res = buildLoginRes();
    const next = vi.fn();

    await controller.login(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.redirect).toBe('/notion');
  });

  it('respects explicit ?redirect= param even for Notion users', async () => {
    MockedNotionRepo.prototype.getNotionData = vi
      .fn()
      .mockResolvedValue({ token: 'stored-tok', owner: 5 });
    const { controller } = buildLoginController();
    const req = {
      body: { email: 'u@example.com', credentials: 'mock' },
      query: { redirect: '/downloads' },
    } as unknown as express.Request;
    const res = buildLoginRes();
    const next = vi.fn();

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
    const recordExecute = vi.fn().mockResolvedValue(undefined);
    const recordError = { execute: recordExecute };

    const authService = {
      loginWithNotion: vi.fn().mockResolvedValue(loginWithNotionResult),
      getHashPassword: vi.fn().mockReturnValue('hashed'),
      newJWTToken: vi.fn().mockResolvedValue(null),
      persistToken: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const userService = {
      getUserFrom: vi.fn().mockResolvedValue(getUserFromResult),
      registerVerifiedIdentity: vi.fn().mockResolvedValue(undefined),
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
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
    const redirect = vi.fn();
    const status = vi.fn().mockReturnValue({ send: vi.fn() });
    return { redirect, status } as unknown as express.Response & {
      redirect: Mock;
      status: Mock;
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
    const recordExecute = vi.fn().mockResolvedValue(undefined);
    const recordError = { execute: recordExecute };

    const authService = {
      loginWithGoogle: vi.fn().mockResolvedValue(loginWithGoogleResult),
      getHashPassword: vi.fn().mockReturnValue('hashed'),
      newJWTToken: vi.fn().mockResolvedValue(null),
      persistToken: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const userService = {
      getUserFrom: vi.fn().mockResolvedValue(getUserFromResult),
      registerVerifiedIdentity: vi.fn().mockResolvedValue(undefined),
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
      markEmailVerified: vi.fn().mockResolvedValue(undefined),
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
    const redirect = vi.fn();
    const status = vi.fn().mockReturnValue({ send: vi.fn() });
    return { redirect, status } as unknown as express.Response & {
      redirect: Mock;
      status: Mock;
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

  it('records oauth_email_not_verified and refuses when the provider reports the email unverified', async () => {
    const { controller, recordExecute } = buildOAuthController({
      ok: false,
      reason: 'email_not_verified',
      message: 'Google reports the email as unverified',
    });
    const req = {
      query: { code: 'auth-code-123' },
    } as unknown as express.Request;
    const res = buildRedirectRes();

    await controller.loginWithGoogle(req, res);

    expect(recordExecute).toHaveBeenCalledWith({
      userId: null,
      surface: 'oauth_google',
      code: 'oauth_email_not_verified',
      context: {
        reason: 'email_not_verified',
        message: 'Google reports the email as unverified',
        userAgent: null,
      },
    });
    expect(res.redirect).toHaveBeenCalledWith(
      '/login?error=google_signin_failed'
    );
  });
});

describe('UsersController.loginWithNotion', () => {
  const buildNotionDb = () => {
    const chainable: Record<string, Mock> = {};
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
      chainable[m] = vi.fn().mockReturnValue(Promise.resolve([1]));
    }
    for (const m of ['where', 'whereNull', 'onConflict']) {
      chainable[m] = vi.fn().mockReturnValue(chainable);
    }
    chainable['insert'] = vi.fn().mockReturnValue(chainable);
    chainable['merge'] = vi.fn().mockResolvedValue([1]);
    const mockDb = vi.fn().mockReturnValue(chainable);
    return mockDb as unknown as ReturnType<
      typeof import('../data_layer').getDatabase
    >;
  };

  const buildNotionController = (overrides?: {
    getUserFrom?: Mock;
    registerVerifiedIdentity?: Mock;
    newJWTToken?: Mock;
    persistToken?: Mock;
    updateLastLoginAt?: Mock;
    loginWithNotion?: Mock;
  }) => {
    const mockUser = { id: 11, email: 'n@example.com' };
    const userService = {
      getUserFrom:
        overrides?.getUserFrom ??
        vi.fn().mockResolvedValueOnce(null).mockResolvedValue(mockUser),
      registerVerifiedIdentity:
        overrides?.registerVerifiedIdentity ??
        vi.fn().mockResolvedValue([{ id: 11 }]),
      updateLastLoginAt:
        overrides?.updateLastLoginAt ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithNotion:
        overrides?.loginWithNotion ??
        vi.fn().mockResolvedValue({
          email: 'n@example.com',
          name: 'Notion User',
          accessData: {},
        }),
      getHashPassword: vi.fn().mockReturnValue('hashed'),
      newJWTToken:
        overrides?.newJWTToken ?? vi.fn().mockResolvedValue('notion-jwt'),
      persistToken:
        overrides?.persistToken ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      buildNotionDb()
    );
    return { controller, userService, authService };
  };

  const buildNotionRes = () => {
    const redirect = vi.fn();
    const cookie = vi.fn();
    const status = vi.fn().mockReturnThis();
    return { redirect, cookie, status } as unknown as express.Response & {
      redirect: Mock;
      cookie: Mock;
      status: Mock;
    };
  };

  it("registers new Notion users with signup_origin set to 'notion_oauth'", async () => {
    const register = vi.fn().mockResolvedValue([{ id: 11 }]);
    const { controller } = buildNotionController({
      registerVerifiedIdentity: register,
    });
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
      'notion_oauth',
      expect.objectContaining({ method: 'notion_oauth' })
    );
  });

  it('does not call register for an existing Notion user', async () => {
    const existingUser = { id: 12, email: 'existing@example.com' };
    const getUserFrom = vi.fn().mockResolvedValue(existingUser);
    const register = vi.fn();
    const { controller } = buildNotionController({
      getUserFrom,
      registerVerifiedIdentity: register,
    });
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
    const MockedNotionRepo = NotionRepository as MockedClass<
      typeof NotionRepository
    >;
    MockedNotionRepo.prototype.getNotionData = vi.fn().mockResolvedValue(null);
    const mockUser = { id: 5, email: 'u@example.com', pw: '$2b$10$hash' };
    const userService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      isValidLogin: vi.fn().mockReturnValue(true),
      comparePassword: vi.fn().mockReturnValue(true),
      newJWTToken: vi.fn().mockResolvedValue('login-jwt'),
      persistToken: vi.fn().mockResolvedValue(undefined),
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
    const next = vi.fn();

    await controller.login(req, res, next);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'login-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });

  it('sets maxAge, httpOnly, and sameSite on the token cookie during registration', async () => {
    const register = vi.fn().mockResolvedValue([{ id: 1 }]);
    const newJWTToken = vi.fn().mockResolvedValue('register-jwt');
    const { controller } = buildController({ register, newJWTToken });
    const req = {
      body: { email: 'new@example.com', password: SAMPLE_PW },
      query: {},
    } as unknown as express.Request;
    const res = buildRes();
    const next = vi.fn();

    await controller.register(req, res, next);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'register-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });

  it('sets maxAge, httpOnly, and sameSite on the token cookie during magic link verification', async () => {
    const verifyMagicToken = vi
      .fn()
      .mockResolvedValue({ userId: 5, purpose: 'login' });
    const newJWTToken = vi.fn().mockResolvedValue('magic-jwt');
    const persistToken = vi.fn().mockResolvedValue(undefined);
    const updateLastLoginAt = vi.fn().mockResolvedValue(undefined);
    const getUserById = vi
      .fn()
      .mockResolvedValue({ id: 5, email: 'al@example.com' });
    const markEmailVerified = vi.fn().mockResolvedValue(1);
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
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      cookie: vi.fn(),
    } as unknown as express.Response & { cookie: Mock };
    const next = vi.fn();

    await controller.verifyMagicLink(req, res, next);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'magic-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });

  it('sets maxAge, httpOnly, and sameSite on the token cookie during Google OAuth login', async () => {
    const mockUser = { id: 7, email: 'g@example.com' };
    const MockedNotionRepo = NotionRepository as MockedClass<
      typeof NotionRepository
    >;
    MockedNotionRepo.prototype.getNotionData = vi.fn().mockResolvedValue(null);
    const userService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
      registerVerifiedIdentity: vi.fn().mockResolvedValue([{ id: 7 }]),
      markEmailVerified: vi.fn().mockResolvedValue(1),
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const newJWTToken = vi.fn().mockResolvedValue('google-jwt');
    const authService = {
      loginWithGoogle: vi
        .fn()
        .mockResolvedValue({ ok: true, email: 'g@example.com', name: 'G' }),
      getHashPassword: vi.fn().mockReturnValue('hashed'),
      newJWTToken,
      persistToken: vi.fn().mockResolvedValue(undefined),
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
      redirect: vi.fn(),
      cookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as unknown as express.Response & { cookie: Mock };

    await controller.loginWithGoogle(req, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'google-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });

  it('sets maxAge, httpOnly, and sameSite on the token cookie during Microsoft OAuth login', async () => {
    const MockedOauthIdentitiesRepo = OauthIdentitiesRepository as MockedClass<
      typeof OauthIdentitiesRepository
    >;
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = vi
      .fn()
      .mockResolvedValue(null);
    MockedOauthIdentitiesRepo.prototype.link = vi
      .fn()
      .mockResolvedValue(undefined);
    const MockedNotionRepo = NotionRepository as MockedClass<
      typeof NotionRepository
    >;
    MockedNotionRepo.prototype.getNotionData = vi.fn().mockResolvedValue(null);

    const mockUser = { id: 11, email: 'm@example.com' };
    const newJWTToken = vi.fn().mockResolvedValue('microsoft-jwt');
    const userService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
      getUserById: vi.fn().mockResolvedValue(mockUser),
      registerVerifiedIdentity: vi.fn().mockResolvedValue([{ id: 11 }]),
      markEmailVerified: vi.fn().mockResolvedValue(1),
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithMicrosoft: vi.fn().mockResolvedValue({
        subject: 'ms-sub',
        email: 'm@example.com',
        name: 'M',
        emailVerified: true,
      }),
      getHashPassword: vi.fn().mockReturnValue('hashed'),
      newJWTToken,
      persistToken: vi.fn().mockResolvedValue(undefined),
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
      redirect: vi.fn(),
      cookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as unknown as express.Response & { cookie: Mock };

    await controller.loginWithMicrosoft(req, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'microsoft-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });

  it('sets maxAge, httpOnly, and sameSite on the token cookie during Apple OAuth login', async () => {
    const MockedOauthIdentitiesRepo = OauthIdentitiesRepository as MockedClass<
      typeof OauthIdentitiesRepository
    >;
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = vi
      .fn()
      .mockResolvedValue(null);
    MockedOauthIdentitiesRepo.prototype.link = vi
      .fn()
      .mockResolvedValue(undefined);
    const MockedNotionRepo = NotionRepository as MockedClass<
      typeof NotionRepository
    >;
    MockedNotionRepo.prototype.getNotionData = vi.fn().mockResolvedValue(null);

    const mockUser = { id: 20, email: 'apple@example.com' };
    const newJWTToken = vi.fn().mockResolvedValue('apple-jwt');
    const userService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
      getUserById: vi.fn().mockResolvedValue(mockUser),
      registerVerifiedIdentity: vi.fn().mockResolvedValue([{ id: 20 }]),
      markEmailVerified: vi.fn().mockResolvedValue(1),
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithApple: vi.fn().mockResolvedValue({
        ok: true,
        subject: 'apple-sub',
        email: 'apple@example.com',
        emailVerified: true,
      }),
      getHashPassword: vi.fn().mockReturnValue('hashed'),
      newJWTToken,
      persistToken: vi.fn().mockResolvedValue(undefined),
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
      redirect: vi.fn(),
      cookie: vi.fn(),
      clearCookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as unknown as express.Response & { cookie: Mock };

    await controller.loginWithApple(req, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'token',
      'apple-jwt',
      expect.objectContaining(EXPECTED_COOKIE_OPTIONS)
    );
  });

  it('sets maxAge, httpOnly, and sameSite on the token cookie during Notion OAuth login', async () => {
    const chainable: Record<string, Mock> = {};
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
      chainable[m] = vi.fn().mockReturnValue(Promise.resolve([1]));
    }
    for (const m of ['where', 'whereNull', 'onConflict']) {
      chainable[m] = vi.fn().mockReturnValue(chainable);
    }
    chainable['insert'] = vi.fn().mockReturnValue(chainable);
    chainable['merge'] = vi.fn().mockResolvedValue([1]);
    const mockDb = vi.fn().mockReturnValue(chainable) as unknown as ReturnType<
      typeof import('../data_layer').getDatabase
    >;

    const mockUser = { id: 11, email: 'n@example.com' };
    const newJWTToken = vi.fn().mockResolvedValue('notion-jwt');
    const userService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
      registerVerifiedIdentity: vi.fn().mockResolvedValue([{ id: 11 }]),
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      loginWithNotion: vi.fn().mockResolvedValue({
        email: 'n@example.com',
        name: 'N',
        accessData: {},
      }),
      getHashPassword: vi.fn().mockReturnValue('hashed'),
      newJWTToken,
      persistToken: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthenticationService;
    const controller = new UsersController(userService, authService, mockDb);
    const req = {
      query: { code: 'notion-code' },
      cookies: {},
      headers: {},
    } as unknown as express.Request;
    const res = {
      redirect: vi.fn(),
      cookie: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as unknown as express.Response & { cookie: Mock };

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
      getSubscriptionLinkedEmail: vi.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {},
      json: vi.fn(),
    } as unknown as express.Response & { json: Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.user.email_verified).toBe(true);
  });

  it('marks autoSyncActive true for a patreon lifetime user with no Auto Sync subscription', async () => {
    (
      SubscriptionService.getUserActiveSubscriptions as Mock
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
      getSubscriptionLinkedEmail: vi.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {},
      json: vi.fn(),
    } as unknown as express.Response & { json: Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.autoSyncActive).toBe(true);
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
      getSubscriptionLinkedEmail: vi.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {},
      json: vi.fn(),
    } as unknown as express.Response & { json: Mock };

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
      getSubscriptionLinkedEmail: vi.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {},
      json: vi.fn(),
    } as unknown as express.Response & { json: Mock };

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
      getSubscriptionLinkedEmail: vi.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
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
      json: vi.fn(),
    } as unknown as express.Response & { json: Mock };

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
      getSubscriptionLinkedEmail: vi.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
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
      json: vi.fn(),
    } as unknown as express.Response & { json: Mock };

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
      getSubscriptionLinkedEmail: vi.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
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
      json: vi.fn(),
    } as unknown as express.Response & { json: Mock };

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
      getSubscriptionLinkedEmail: vi.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {},
      json: vi.fn(),
    } as unknown as express.Response & { json: Mock };

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
      getSubscriptionLinkedEmail: vi.fn().mockResolvedValue(null),
    } as unknown as UsersService;
    const authService = {
      getUserFrom: vi.fn().mockResolvedValue(mockUser),
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    const req = { cookies: { token: 'valid' } } as unknown as express.Request;
    const res = {
      locals: {},
      json: vi.fn(),
    } as unknown as express.Response & { json: Mock };

    await controller.getLocals(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.user.email_verified).toBe(false);
  });
});

describe('UsersController.loginWithAppleNative', () => {
  const MockedOauthIdentitiesRepo = OauthIdentitiesRepository as MockedClass<
    typeof OauthIdentitiesRepository
  >;

  beforeEach(() => {
    MockedOauthIdentitiesRepo.mockClear();
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = vi
      .fn()
      .mockResolvedValue(null);
    MockedOauthIdentitiesRepo.prototype.link = vi
      .fn()
      .mockResolvedValue(undefined);
  });

  const buildNativeController = (overrides?: {
    getUserFrom?: Mock;
    getUserById?: Mock;
    registerVerifiedIdentity?: Mock;
    markEmailVerified?: Mock;
    newJWTToken?: Mock;
    persistToken?: Mock;
    updateLastLoginAt?: Mock;
    verifyAppleIdentityToken?: Mock;
  }) => {
    const recordExecute = vi.fn().mockResolvedValue(undefined);
    const mockUser = { id: 30, email: 'native-apple@example.com' };
    const userService = {
      getUserFrom:
        overrides?.getUserFrom ??
        vi.fn().mockResolvedValueOnce(null).mockResolvedValue(mockUser),
      getUserById:
        overrides?.getUserById ?? vi.fn().mockResolvedValue(mockUser),
      registerVerifiedIdentity:
        overrides?.registerVerifiedIdentity ??
        vi.fn().mockResolvedValue([{ id: 30 }]),
      markEmailVerified:
        overrides?.markEmailVerified ?? vi.fn().mockResolvedValue(1),
      updateLastLoginAt:
        overrides?.updateLastLoginAt ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as UsersService;
    const authService = {
      verifyAppleIdentityToken:
        overrides?.verifyAppleIdentityToken ??
        vi.fn().mockResolvedValue({
          ok: true,
          subject: 'native-sub-001',
          email: 'native-apple@example.com',
        }),
      getHashPassword: vi.fn().mockReturnValue('hashed'),
      newJWTToken:
        overrides?.newJWTToken ?? vi.fn().mockResolvedValue('native-apple-jwt'),
      persistToken:
        overrides?.persistToken ?? vi.fn().mockResolvedValue(undefined),
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
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const cookie = vi.fn();
    return { json, status, cookie } as unknown as express.Response & {
      json: Mock;
      status: Mock;
      cookie: Mock;
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
    const verifyAppleIdentityToken = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'invalid_identity_token' });
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
    const register = vi.fn().mockResolvedValue([{ id: 30 }]);
    const { controller } = buildNativeController({
      registerVerifiedIdentity: register,
    });
    const res = buildNativeRes();

    await controller.loginWithAppleNative(buildReq(), res);

    expect(register).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'native-apple@example.com',
      'apple',
      expect.objectContaining({ method: 'apple' })
    );
    expect(MockedOauthIdentitiesRepo.prototype.link).toHaveBeenCalledWith(
      'apple',
      'native-sub-001',
      30,
      undefined
    );
  });

  it('signs in via subject lookup without re-registering when the identity already exists', async () => {
    const register = vi.fn();
    MockedOauthIdentitiesRepo.prototype.findByProviderAndSubject = vi
      .fn()
      .mockResolvedValue({
        user_id: 30,
        provider: 'apple',
        subject: 'native-sub-001',
      });
    const getUserById = vi
      .fn()
      .mockResolvedValue({ id: 30, email: 'native-apple@example.com' });

    const { controller } = buildNativeController({
      registerVerifiedIdentity: register,
      getUserById,
    });
    const res = buildNativeRes();

    await controller.loginWithAppleNative(buildReq(), res);

    expect(register).not.toHaveBeenCalled();
    expect(getUserById).toHaveBeenCalledWith('30');
    expect(MockedOauthIdentitiesRepo.prototype.link).not.toHaveBeenCalled();
  });

  it('returns 401 when email is absent and no existing identity row exists', async () => {
    const verifyAppleIdentityToken = vi.fn().mockResolvedValue({
      ok: true,
      subject: 'native-sub-noemail',
      email: undefined,
    });
    const { controller } = buildNativeController({ verifyAppleIdentityToken });
    const res = buildNativeRes();

    await controller.loginWithAppleNative(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'email_required_for_new_account',
    });
  });

  it('uses fullName from request body when creating a new account', async () => {
    const register = vi.fn().mockResolvedValue([{ id: 30 }]);
    const { controller } = buildNativeController({
      registerVerifiedIdentity: register,
    });
    const res = buildNativeRes();

    await controller.loginWithAppleNative(
      buildReq({ fullName: { givenName: 'Jane', familyName: 'Doe' } }),
      res
    );

    expect(register).toHaveBeenCalledWith(
      'Jane Doe',
      expect.any(String),
      'native-apple@example.com',
      'apple',
      expect.objectContaining({ method: 'apple' })
    );
  });

  it('falls back to email as name when fullName is absent', async () => {
    const register = vi.fn().mockResolvedValue([{ id: 30 }]);
    const { controller } = buildNativeController({
      registerVerifiedIdentity: register,
    });
    const res = buildNativeRes();

    await controller.loginWithAppleNative(buildReq(), res);

    expect(register).toHaveBeenCalledWith(
      'native-apple@example.com',
      expect.any(String),
      'native-apple@example.com',
      'apple',
      expect.objectContaining({ method: 'apple' })
    );
  });

  it('rejects and records oauth_email_not_verified when Apple reports the email unverified', async () => {
    const verifyAppleIdentityToken = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'email_not_verified' });
    const { controller, recordExecute } = buildNativeController({
      verifyAppleIdentityToken,
    });
    const res = buildNativeRes();

    await controller.loginWithAppleNative(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'email_not_verified' });
    expect(recordExecute).toHaveBeenCalledWith({
      userId: null,
      surface: 'oauth_apple_native',
      code: 'oauth_email_not_verified',
    });
  });
});

describe('UsersController.logOutEverywhere', () => {
  const buildLogOutEverywhereController = (logOutEverywhere: Mock) => {
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
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const clearCookie = vi.fn();
    return {
      json,
      status,
      clearCookie,
      locals: { owner },
    } as unknown as express.Response & {
      json: Mock;
      status: Mock;
      clearCookie: Mock;
    };
  };

  it('revokes every session for the session owner and clears the cookie', async () => {
    const logOutEverywhere = vi.fn().mockResolvedValue(3);
    const { controller } = buildLogOutEverywhereController(logOutEverywhere);
    const req = {
      body: { owner: 999 },
    } as unknown as express.Request;
    const res = buildResWithLocals(7);
    const next = vi.fn();

    await controller.logOutEverywhere(req, res, next);

    expect(logOutEverywhere).toHaveBeenCalledWith(7);
    expect(logOutEverywhere).not.toHaveBeenCalledWith(999);
    expect(res.clearCookie).toHaveBeenCalledWith('token');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when there is no session owner and never revokes', async () => {
    const logOutEverywhere = vi.fn();
    const { controller } = buildLogOutEverywhereController(logOutEverywhere);
    const req = {} as express.Request;
    const res = buildResWithLocals(null);
    const next = vi.fn();

    await controller.logOutEverywhere(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(logOutEverywhere).not.toHaveBeenCalled();
  });
});

describe('UsersController.newPassword', () => {
  const buildNewPasswordController = (
    overrides: {
      getUserByLiveResetToken?: Mock;
      updatePassword?: Mock;
      logOutEverywhere?: Mock;
      markEmailVerified?: Mock;
    } = {}
  ) => {
    const getUserByLiveResetToken =
      overrides.getUserByLiveResetToken ?? vi.fn().mockResolvedValue({ id: 7 });
    const updatePassword =
      overrides.updatePassword ?? vi.fn().mockResolvedValue(1);
    const logOutEverywhere =
      overrides.logOutEverywhere ?? vi.fn().mockResolvedValue(1);
    const markEmailVerified =
      overrides.markEmailVerified ?? vi.fn().mockResolvedValue(undefined);
    const userService = {
      getUserByLiveResetToken,
      updatePassword,
      markEmailVerified,
    } as unknown as UsersService;
    const authService = {
      isNewPasswordValid: vi.fn().mockReturnValue(false),
      getHashPassword: vi.fn().mockReturnValue('hashed'),
      logOutEverywhere,
    } as unknown as AuthenticationService;
    const controller = new UsersController(
      userService,
      authService,
      {} as ReturnType<typeof import('../data_layer').getDatabase>
    );
    return { controller, updatePassword, logOutEverywhere, markEmailVerified };
  };

  const buildReq = () =>
    ({
      body: { reset_token: 'a-token', password: 'longenoughpw' },
      headers: {},
      ip: '203.0.113.9',
    }) as unknown as express.Request;

  const buildRes = () =>
    ({
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    }) as unknown as express.Response;

  it('revokes sessions only after the token is successfully redeemed', async () => {
    const { controller, logOutEverywhere } = buildNewPasswordController();
    const res = buildRes();

    await controller.newPassword(buildReq(), res, vi.fn());

    expect(logOutEverywhere).toHaveBeenCalledWith(7);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('marks the email verified once the emailed reset link is redeemed', async () => {
    const { controller, markEmailVerified } = buildNewPasswordController();
    const res = buildRes();

    await controller.newPassword(buildReq(), res, vi.fn());

    expect(markEmailVerified).toHaveBeenCalledWith('7');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('still reports success when marking the email verified fails', async () => {
    const { controller } = buildNewPasswordController({
      markEmailVerified: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const res = buildRes();
    const next = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await controller.newPassword(buildReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not mark the email verified when the token no longer redeems', async () => {
    const { controller, markEmailVerified } = buildNewPasswordController({
      getUserByLiveResetToken: vi.fn().mockResolvedValue(null),
      updatePassword: vi.fn().mockResolvedValue(0),
    });

    await controller.newPassword(buildReq(), buildRes(), vi.fn());

    expect(markEmailVerified).not.toHaveBeenCalled();
  });

  // A stale token must not stay usable as a way to force the owner out.
  it('never revokes sessions when the token no longer redeems', async () => {
    const { controller, logOutEverywhere } = buildNewPasswordController({
      getUserByLiveResetToken: vi.fn().mockResolvedValue(null),
      updatePassword: vi.fn().mockResolvedValue(0),
    });
    const res = buildRes();

    await controller.newPassword(buildReq(), res, vi.fn());

    expect(logOutEverywhere).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('does not revoke when the row is gone even if a redeem is reported', async () => {
    const { controller, logOutEverywhere } = buildNewPasswordController({
      getUserByLiveResetToken: vi.fn().mockResolvedValue(null),
    });
    const res = buildRes();

    await controller.newPassword(buildReq(), res, vi.fn());

    expect(logOutEverywhere).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('UsersController.getAiCredits', () => {
  it('returns 401 without an authenticated owner', async () => {
    const { controller } = buildController();
    const res = buildRes();
    (res as unknown as { locals: Record<string, unknown> }).locals = {};
    await controller.getAiCredits({} as express.Request, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Authentication required',
    });
  });
});
