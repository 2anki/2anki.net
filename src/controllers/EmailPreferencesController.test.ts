import { vi, type Mocked } from 'vitest';
import { Request, Response } from 'express';

import { EmailPreferencesController } from './EmailPreferencesController';
import type { IEmailPreferencesRepository } from '../data_layer/EmailPreferencesRepository';

function buildMocks(userId = 1) {
  const prefRepo: Mocked<IEmailPreferencesRepository> = {
    isOptedOut: vi.fn().mockResolvedValue(false),
    optOut: vi.fn().mockResolvedValue(undefined),
    optIn: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new EmailPreferencesController(prefRepo);
  const res = {
    locals: { owner: userId },
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { prefRepo, controller, res };
}

describe('EmailPreferencesController.get', () => {
  it('returns 200 with marketingOptOut false when user has no preference', async () => {
    const { controller, res } = buildMocks(1);
    const req = {} as Request;

    await controller.get(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ marketingOptOut: false });
  });

  it('returns 200 with marketingOptOut true when user has opted out', async () => {
    const { controller, prefRepo, res } = buildMocks(1);
    prefRepo.isOptedOut.mockResolvedValueOnce(true);
    const req = {} as Request;

    await controller.get(req, res);

    expect(res.json).toHaveBeenCalledWith({ marketingOptOut: true });
  });
});

describe('EmailPreferencesController.update', () => {
  it('opts out when marketingOptOut is true', async () => {
    const { controller, prefRepo, res } = buildMocks(5);
    const req = { body: { marketingOptOut: true } } as unknown as Request;

    await controller.update(req, res);

    expect(prefRepo.optOut).toHaveBeenCalledWith(5);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('opts in when marketingOptOut is false', async () => {
    const { controller, prefRepo, res } = buildMocks(5);
    const req = { body: { marketingOptOut: false } } as unknown as Request;

    await controller.update(req, res);

    expect(prefRepo.optIn).toHaveBeenCalledWith(5);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 when marketingOptOut is not a boolean', async () => {
    const { controller, res } = buildMocks(1);
    const req = { body: { marketingOptOut: 'yes' } } as unknown as Request;

    await controller.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
