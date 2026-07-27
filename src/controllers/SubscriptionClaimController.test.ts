import { Request, Response } from 'express';
import { SubscriptionClaimController } from './SubscriptionClaimController';
import { CLAIM_INITIATE_MESSAGE } from '../usecases/subscriptions/ClaimSubscriptionUseCase';

process.env.THE_HASHING_SECRET = 'test-secret-for-jest';

function buildReq(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): Request {
  return {
    body,
    headers,
    ip: '127.0.0.1',
  } as unknown as Request;
}

function buildRes(owner = 1): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    locals: { owner },
  } as unknown as Response;
}

describe('SubscriptionClaimController.initiate', () => {
  it('returns 400 for missing email', async () => {
    const controller = new SubscriptionClaimController(
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn() } as never
    );
    const res = buildRes();
    await controller.initiate(buildReq({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Invalid email address.',
    });
  });

  it('returns 400 for invalid email without @', async () => {
    const controller = new SubscriptionClaimController(
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn() } as never
    );
    const res = buildRes();
    await controller.initiate(buildReq({ email: 'notanemail' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 with the identical message regardless of match', async () => {
    const claimUseCase = {
      execute: jest.fn().mockResolvedValue({ message: CLAIM_INITIATE_MESSAGE }),
    };
    const controller = new SubscriptionClaimController(
      claimUseCase as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn() } as never
    );
    const res = buildRes(5);
    await controller.initiate(buildReq({ email: 'test@example.com' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: CLAIM_INITIATE_MESSAGE });
  });
});

describe('SubscriptionClaimController.confirm', () => {
  it('returns 400 for missing token', async () => {
    const controller = new SubscriptionClaimController(
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn() } as never
    );
    const res = buildRes();
    await controller.confirm(buildReq({}), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Token is required.' });
  });

  it('returns 200 on success', async () => {
    const confirmUseCase = {
      execute: jest.fn().mockResolvedValue({ success: true }),
    };
    const controller = new SubscriptionClaimController(
      { execute: jest.fn() } as never,
      confirmUseCase as never,
      { execute: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn() } as never
    );
    const res = buildRes(3);
    await controller.confirm(buildReq({ token: 'valid-raw-token' }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Subscription claimed.' });
  });

  it('returns 409 for already consumed token', async () => {
    const confirmUseCase = {
      execute: jest
        .fn()
        .mockResolvedValue({ success: false, reason: 'already_consumed' }),
    };
    const controller = new SubscriptionClaimController(
      { execute: jest.fn() } as never,
      confirmUseCase as never,
      { execute: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn() } as never
    );
    const res = buildRes(3);
    await controller.confirm(buildReq({ token: 'used-token' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('returns 409 when user already has active subscription', async () => {
    const confirmUseCase = {
      execute: jest
        .fn()
        .mockResolvedValue({ success: false, reason: 'user_has_active_sub' }),
    };
    const controller = new SubscriptionClaimController(
      { execute: jest.fn() } as never,
      confirmUseCase as never,
      { execute: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn() } as never
    );
    const res = buildRes(3);
    await controller.confirm(buildReq({ token: 'some-token' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('returns 400 for invalid or expired token', async () => {
    const confirmUseCase = {
      execute: jest
        .fn()
        .mockResolvedValue({ success: false, reason: 'invalid_token' }),
    };
    const controller = new SubscriptionClaimController(
      { execute: jest.fn() } as never,
      confirmUseCase as never,
      { execute: jest.fn().mockResolvedValue(undefined) } as never,
      { execute: jest.fn() } as never
    );
    const res = buildRes(3);
    await controller.confirm(buildReq({ token: 'expired-token' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
