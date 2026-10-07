import { vi, type Mock } from 'vitest';
import { Response } from 'express';
import PassCheckoutController from './PassCheckoutController';
import { CreatePassCheckoutUseCase } from '../usecases/checkout/CreatePassCheckoutUseCase';
import type { PassKind } from '../data_layer/UserPassRepository';

const makeRes = (
  locals: Record<string, unknown> = { owner: 42, email: 'a@b.test' }
) => {
  const json = vi.fn();
  return {
    locals,
    json,
  } as unknown as Response & {
    json: Mock;
  };
};

const makeController = (
  execute: Mock,
  passKind: PassKind = '24h'
): { controller: PassCheckoutController; record: Mock } => {
  const record = vi.fn();
  const useCase = { execute } as unknown as CreatePassCheckoutUseCase;
  return {
    controller: new PassCheckoutController(useCase, passKind, { record }),
    record,
  };
};

const resolving = () =>
  vi.fn().mockResolvedValue({ url: 'https://stripe/session' });

describe('PassCheckoutController', () => {
  it('forwards owner and email to the use case and serializes the result', async () => {
    const execute = resolving();
    const { controller } = makeController(execute);
    const res = makeRes();

    await controller.createSession({} as never, res);

    expect(execute).toHaveBeenCalledWith({ userId: 42, userEmail: 'a@b.test' });
    expect(res.json).toHaveBeenCalledWith({ url: 'https://stripe/session' });
  });

  it('forwards the anon_id cookie to the use case when present', async () => {
    const execute = resolving();
    const { controller } = makeController(execute);
    const req = { cookies: { anon_id: 'anon-uuid-123' } } as never;

    await controller.createSession(req, makeRes());

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ anonId: 'anon-uuid-123' })
    );
  });

  it('forwards the resolved Stripe customer id from res.locals', async () => {
    const execute = resolving();
    const { controller } = makeController(execute);
    const res = makeRes({
      owner: 42,
      email: 'a@b.test',
      stripeCustomerId: 'cus_abc',
    });

    await controller.createSession({} as never, res);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: 'cus_abc' })
    );
  });

  it('propagates use case errors', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('stripe down'));
    const { controller } = makeController(execute);

    await expect(
      controller.createSession({} as never, makeRes())
    ).rejects.toThrow('stripe down');
  });

  it.each<PassKind>(['24h', '7d', '120d'])(
    'records checkout_started carrying %s as the plan',
    async (passKind) => {
      const { controller, record } = makeController(resolving(), passKind);

      await controller.createSession({} as never, makeRes());

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'checkout_started',
          props: expect.objectContaining({ plan: passKind }),
        })
      );
    }
  );

  it('attributes the start to the signed-in user, not to an anonymous id', async () => {
    const { controller, record } = makeController(resolving());
    const req = { cookies: { anon_id: 'anon-uuid-123' } } as never;

    await controller.createSession(req, makeRes());

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 42, anonymous_id: null })
    );
  });

  it('attributes an anonymous start to the anon id', async () => {
    const { controller, record } = makeController(resolving());
    const req = { cookies: { anon_id: 'anon-uuid-123' } } as never;

    await controller.createSession(req, makeRes({}));

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: null,
        anonymous_id: 'anon-uuid-123',
      })
    );
  });

  it('carries the surface and pricing variant so starts join to completions', async () => {
    const { controller, record } = makeController(resolving());
    const req = {
      body: { surface: 'limit-wall', variant: 'semester-first' },
    } as never;

    await controller.createSession(req, makeRes());

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          surface: 'limit-wall',
          variant: 'semester-first',
        }),
      })
    );
  });

  it('records nothing when checkout could not be created', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('stripe down'));
    const { controller, record } = makeController(execute);

    await expect(
      controller.createSession({} as never, makeRes())
    ).rejects.toThrow('stripe down');

    expect(record).not.toHaveBeenCalled();
  });
});
