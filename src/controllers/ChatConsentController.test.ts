import { vi } from 'vitest';
import { Request, Response } from 'express';
import ChatConsentController from './ChatConsentController';

function buildRes(owner = 1): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    sendStatus: vi.fn().mockReturnThis(),
    locals: { owner },
  } as unknown as Response;
}

function buildReq(): Request {
  return {} as unknown as Request;
}

describe('ChatConsentController.recordConsent', () => {
  it('calls execute with the owner and returns 204', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const controller = new ChatConsentController({ execute } as never);
    const res = buildRes(7);
    await controller.recordConsent(buildReq(), res);
    expect(execute).toHaveBeenCalledWith(7);
    expect(res.sendStatus).toHaveBeenCalledWith(204);
  });

  it('propagates errors by rethrowing', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('DB down'));
    const controller = new ChatConsentController({ execute } as never);
    const res = buildRes(3);
    await expect(controller.recordConsent(buildReq(), res)).rejects.toThrow(
      'DB down'
    );
  });
});
