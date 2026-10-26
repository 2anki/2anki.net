import { vi } from 'vitest';
import { Request, Response } from 'express';
import OpsDeleteAccountController from './OpsDeleteAccountController';
import type { DeleteAccountOutcome } from '../usecases/ops/DeleteAccountByEmailUseCase';

const makeResponse = () => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    locals: { owner: 1, email: 'ops@example.com' },
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
};

const account = {
  userId: 4242,
  createdAt: null,
  lastLoginAt: null,
  activeSubscription: false,
  activePass: null,
  jobs: 0,
  uploads: 0,
};

const run = async (body: unknown, outcome: DeleteAccountOutcome) => {
  const execute = vi.fn().mockResolvedValue(outcome);
  const res = makeResponse();
  await new OpsDeleteAccountController({ execute }).deleteAccount(
    { body } as Request,
    res as unknown as Response
  );
  return { execute, res };
};

describe('OpsDeleteAccountController', () => {
  it('rejects a missing email without calling the use case', async () => {
    const { execute, res } = await run({}, { status: 'not_found' });

    expect(res.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('treats a request without dryRun as a preview', async () => {
    const { execute, res } = await run(
      { email: ' target@example.com ' },
      { status: 'preview', account }
    );

    expect(execute).toHaveBeenCalledWith({
      email: 'target@example.com',
      dryRun: true,
      force: false,
      operatorId: 1,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ dryRun: true, account });
  });

  it('refuses a real delete when the confirmation email does not match', async () => {
    const { execute, res } = await run(
      {
        email: 'target@example.com',
        confirmEmail: 'other@example.com',
        dryRun: false,
      },
      { status: 'deleted', userId: 4242 }
    );

    expect(res.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it('deletes when the confirmation matches, ignoring case', async () => {
    const { execute, res } = await run(
      {
        email: 'target@example.com',
        confirmEmail: 'Target@Example.com',
        dryRun: false,
      },
      { status: 'deleted', userId: 4242 }
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false, force: false })
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ dryRun: false, userId: 4242 });
  });

  it('passes force only when it is exactly true', async () => {
    const { execute } = await run(
      {
        email: 'target@example.com',
        confirmEmail: 'target@example.com',
        dryRun: false,
        force: 'true',
      },
      { status: 'paid', account }
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ force: false })
    );
  });

  it.each([
    [{ status: 'not_found' } as const, 404],
    [{ status: 'own_account' } as const, 409],
    [{ status: 'paid', account } as const, 409],
    [{ status: 'billing_failed' } as const, 502],
  ])('maps %o to %i', async (outcome, status) => {
    const { res } = await run({ email: 'target@example.com' }, outcome);

    expect(res.statusCode).toBe(status);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });

  it('returns 500 when the use case throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const execute = vi.fn().mockRejectedValue(new Error('db down'));
    const res = makeResponse();

    await new OpsDeleteAccountController({ execute }).deleteAccount(
      { body: { email: 'target@example.com' } } as Request,
      res as unknown as Response
    );

    expect(res.statusCode).toBe(500);
  });
});
