import type express from 'express';

process.env.THE_HASHING_SECRET = 'test-secret-for-jest';

const STORED_HASH = 'stored-hash-value';
const TYPED_SECRET = 'typed-secret';

const usersRepoMock = {
  getById: jest.fn(),
  getByEmail: jest.fn(),
  applyEmailChange: jest.fn(),
};
const oauthRepoMock = { hasIdentityForUser: jest.fn() };
const tokenRepoMock = {
  insert: jest.fn().mockResolvedValue({ id: 1 }),
  findByTokenHash: jest.fn(),
  findLivePendingByUser: jest.fn(),
  deleteLivePendingByUser: jest.fn(),
  countRecentByUser: jest.fn().mockResolvedValue(0),
};

jest.mock('../data_layer/UsersRepository', () => ({
  __esModule: true,
  default: jest.fn(() => usersRepoMock),
}));
jest.mock('../data_layer/OauthIdentitiesRepository', () => ({
  __esModule: true,
  default: jest.fn(() => oauthRepoMock),
}));
jest.mock('../data_layer/EmailChangeTokenRepository', () => ({
  __esModule: true,
  default: jest.fn(() => tokenRepoMock),
}));

import UsersController from './UsersControllers';
import hmacToken from '../lib/misc/hmacToken';
import type AuthenticationService from '../services/AuthenticationService';
import type UsersService from '../services/UsersService';
import type { IEmailService } from '../services/EmailService/EmailService';

const CURRENT_USER = {
  id: 7,
  email: 'old@example.com',
  password: STORED_HASH,
};

const emailService = {
  sendEmailChangeConfirmationEmail: jest.fn().mockResolvedValue(undefined),
  sendEmailChangeNotificationEmail: jest.fn().mockResolvedValue(undefined),
} as unknown as IEmailService;

const buildController = (
  authOverrides: Partial<AuthenticationService> = {}
) => {
  const authService = {
    comparePassword: jest.fn().mockReturnValue(true),
    logOutEverywhere: jest.fn().mockResolvedValue(1),
    ...authOverrides,
  } as unknown as AuthenticationService;
  const controller = new UsersController(
    {} as unknown as UsersService,
    authService,
    {} as ReturnType<typeof import('../data_layer').getDatabase>,
    null,
    emailService
  );
  return { controller, authService };
};

const buildRes = (owner?: number) => {
  const res = {
    locals: owner == null ? {} : { owner },
  } as unknown as express.Response & {
    status: jest.Mock;
    json: jest.Mock;
    clearCookie: jest.Mock;
  };
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
};

const asReq = (body: Record<string, unknown>) =>
  ({ body }) as unknown as express.Request;

beforeEach(() => {
  jest.clearAllMocks();
  usersRepoMock.getById.mockResolvedValue(CURRENT_USER);
  usersRepoMock.getByEmail.mockResolvedValue(undefined);
  usersRepoMock.applyEmailChange.mockResolvedValue({ ok: true });
  oauthRepoMock.hasIdentityForUser.mockResolvedValue(false);
  tokenRepoMock.countRecentByUser.mockResolvedValue(0);
});

describe('UsersController.requestEmailChange', () => {
  it('rejects an unauthenticated caller', async () => {
    const { controller } = buildController();
    const res = buildRes();
    await controller.requestEmailChange(
      asReq({ new_email: 'new@example.com', password: TYPED_SECRET }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('sends the confirmation and returns 200 on success', async () => {
    const { controller } = buildController();
    const res = buildRes(7);
    await controller.requestEmailChange(
      asReq({ new_email: 'new@example.com', password: TYPED_SECRET }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(emailService.sendEmailChangeConfirmationEmail).toHaveBeenCalledWith(
      'new@example.com',
      expect.stringContaining('/account/email-change?token=')
    );
  });

  it('returns 401 on a wrong password for a password account', async () => {
    const { controller } = buildController({
      comparePassword: jest.fn().mockReturnValue(false),
    } as Partial<AuthenticationService>);
    const res = buildRes(7);
    await controller.requestEmailChange(
      asReq({ new_email: 'new@example.com', password: TYPED_SECRET }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 403 set_password_first for an OAuth-only account', async () => {
    oauthRepoMock.hasIdentityForUser.mockResolvedValue(true);
    const { controller } = buildController({
      comparePassword: jest.fn().mockReturnValue(false),
    } as Partial<AuthenticationService>);
    const res = buildRes(7);
    await controller.requestEmailChange(
      asReq({ new_email: 'new@example.com', password: TYPED_SECRET }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'set_password_first' })
    );
  });

  it('returns 409 when the email is already used', async () => {
    usersRepoMock.getByEmail.mockResolvedValue({ id: 99 });
    const { controller } = buildController();
    const res = buildRes(7);
    await controller.requestEmailChange(
      asReq({ new_email: 'new@example.com', password: TYPED_SECRET }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('returns 400 for a malformed email', async () => {
    const { controller } = buildController();
    const res = buildRes(7);
    await controller.requestEmailChange(
      asReq({ new_email: 'nope', password: TYPED_SECRET }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('UsersController.confirmEmailChange', () => {
  const liveToken = () => ({
    id: 1,
    user_id: 7,
    new_email: 'new@example.com',
    token_hash: hmacToken('good-token'),
    expires_at: new Date(Date.now() + 30 * 60 * 1000),
    consumed_at: null,
    created_at: new Date(),
  });

  it('returns 400 when the token is missing', async () => {
    const { controller } = buildController();
    const res = buildRes();
    await controller.confirmEmailChange(asReq({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('applies the change, clears the cookie and returns 200', async () => {
    tokenRepoMock.findByTokenHash.mockResolvedValue(liveToken());
    const { controller, authService } = buildController();
    const res = buildRes();
    await controller.confirmEmailChange(asReq({ token: 'good-token' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.clearCookie).toHaveBeenCalledWith('token');
    expect(authService.logOutEverywhere).toHaveBeenCalledWith(7);
  });

  it('returns 409 when another account already holds the email', async () => {
    tokenRepoMock.findByTokenHash.mockResolvedValue(liveToken());
    usersRepoMock.getByEmail.mockResolvedValue({ id: 42 });
    const { controller } = buildController();
    const res = buildRes();
    await controller.confirmEmailChange(asReq({ token: 'good-token' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('returns 400 for an unknown token', async () => {
    tokenRepoMock.findByTokenHash.mockResolvedValue(null);
    const { controller } = buildController();
    const res = buildRes();
    await controller.confirmEmailChange(asReq({ token: 'ghost' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('UsersController.cancelEmailChange', () => {
  it('rejects an unauthenticated caller', async () => {
    const { controller } = buildController();
    const res = buildRes();
    await controller.cancelEmailChange(asReq({}), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('reports a cancelled pending change', async () => {
    tokenRepoMock.deleteLivePendingByUser.mockResolvedValue(1);
    const { controller } = buildController();
    const res = buildRes(7);
    await controller.cancelEmailChange(asReq({}), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ cancelled: true });
  });
});
