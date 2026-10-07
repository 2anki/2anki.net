import { vi, type Mock } from 'vitest';
import { Request, Response } from 'express';

import IapController from './IapController';
import { RedeemAppleTransactionUseCase } from '../usecases/iap/RedeemAppleTransactionUseCase';
import { IapRedeemError } from '../usecases/iap/IapRedeemError';

const makeRes = () => {
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  return {
    locals: {
      owner: 42,
      patreon: false,
      subscriptionInfo: { active: false, email: 'a@b.test', linked_email: '' },
    },
    status,
    json,
  } as unknown as Response & { status: Mock; json: Mock };
};

const makeReq = (body: unknown) => ({ body }) as unknown as Request;

function controllerWith(execute: Mock) {
  const useCase = { execute } as unknown as RedeemAppleTransactionUseCase;
  return new IapController(useCase);
}

describe('IapController', () => {
  it('returns 200 with the message and refreshed locals on success', async () => {
    const expiresAt = new Date('2026-06-02T00:00:00.000Z');
    const execute = vi.fn().mockResolvedValue({
      message: 'Day Pass active — unlimited cards for the next 24 hours',
      pass: { kind: '24h', expiresAt },
    });
    const controller = controllerWith(execute);
    const res = makeRes();

    await controller.redeem(
      makeReq({ jws: 'signed', product_id: 'daypass.24h' }),
      res
    );

    expect(execute).toHaveBeenCalledWith({
      userId: 42,
      jws: 'signed',
      productId: 'daypass.24h',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      message: 'Day Pass active — unlimited cards for the next 24 hours',
      locals: {
        owner: 42,
        patreon: false,
        subscriber: true,
        subscriptionInfo: {
          active: false,
          email: 'a@b.test',
          linked_email: '',
        },
        passExpiresAt: expiresAt.toISOString(),
        passKind: '24h',
      },
    });
  });

  it('returns the credits block and untouched pass locals for a credit pack', async () => {
    const expiresAt = new Date('2026-08-30T00:00:00.000Z');
    const execute = vi.fn().mockResolvedValue({
      message: '250 AI credits added — they last 90 days',
      credits: { amount: 250, expiresAt },
    });
    const controller = controllerWith(execute);
    const res = makeRes();
    res.locals.subscriber = true;
    res.locals.passExpiresAt = '2026-07-01T00:00:00.000Z';
    res.locals.passKind = '120d';

    await controller.redeem(
      makeReq({ jws: 'signed', product_id: 'aicredits.250' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      message: '250 AI credits added — they last 90 days',
      locals: {
        owner: 42,
        patreon: false,
        subscriber: true,
        subscriptionInfo: {
          active: false,
          email: 'a@b.test',
          linked_email: '',
        },
        passExpiresAt: '2026-07-01T00:00:00.000Z',
        passKind: '120d',
      },
      credits: { amount: 250, expiresAt: expiresAt.toISOString() },
    });
  });

  it('returns 400 without calling the use case when the jws is missing', async () => {
    const execute = vi.fn();
    const controller = controllerWith(execute);
    const res = makeRes();

    await controller.redeem(makeReq({ product_id: 'daypass.24h' }), res);

    expect(execute).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false })
    );
  });

  it('returns 400 without calling the use case when the product id is missing', async () => {
    const execute = vi.fn();
    const controller = controllerWith(execute);
    const res = makeRes();

    await controller.redeem(makeReq({ jws: 'signed' }), res);

    expect(execute).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false })
    );
  });

  it('maps an IapRedeemError to its status and message', async () => {
    const execute = vi.fn().mockRejectedValue(IapRedeemError.duplicate());
    const controller = controllerWith(execute);
    const res = makeRes();

    await controller.redeem(
      makeReq({ jws: 'signed', product_id: 'daypass.24h' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      message:
        'This pass is already active on your account — nothing more to do.',
    });
  });

  it('propagates unexpected errors to the error handler', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('boom'));
    const controller = controllerWith(execute);

    await expect(
      controller.redeem(
        makeReq({ jws: 'signed', product_id: 'daypass.24h' }),
        makeRes()
      )
    ).rejects.toThrow('boom');
  });
});
