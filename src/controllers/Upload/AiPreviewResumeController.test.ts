import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { AiPreviewResumeController } from './AiPreviewResumeController';
import {
  AiPreviewHoldExpiredError,
  NoAiPreviewHoldError,
} from '../../usecases/uploads/ResumeAnonymousAiPreviewUseCase';
import { AiCreditsExhaustedError } from '../../lib/claude/aiSpendGuard';

function mockRes(anonymousPassId: number | null): Response {
  const res = {
    locals: { anonymousPassId, requestId: 'req-1' },
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status: vi.fn().mockImplementation(function (this: Response, code: number) {
      (this as unknown as { statusCode: number }).statusCode = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: Response, b: unknown) {
      (this as unknown as { body: unknown }).body = b;
      return this;
    }),
    send: vi.fn().mockImplementation(function (this: Response, b: unknown) {
      (this as unknown as { body: unknown }).body = b;
      return this;
    }),
    set: vi.fn().mockReturnThis(),
    attachment: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function mockReq(anonId: string | null): Request {
  return {
    cookies: anonId == null ? {} : { anon_id: anonId },
  } as unknown as Request;
}

function useCaseStub(execute: ReturnType<typeof vi.fn>) {
  return { execute } as unknown as ConstructorParameters<
    typeof AiPreviewResumeController
  >[0];
}

describe('AiPreviewResumeController', () => {
  it('refuses to resume without a valid pass and never runs AI', async () => {
    const execute = vi.fn();
    const controller = new AiPreviewResumeController(useCaseStub(execute));
    const res = mockRes(null);

    await controller.resume(mockReq('visitor-1'), res);

    expect((res as unknown as { statusCode: number }).statusCode).toBe(403);
    expect((res as unknown as { body: { code: string } }).body.code).toBe(
      'pass_required'
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns the apkg and card count on a successful resume', async () => {
    const execute = vi.fn().mockResolvedValue({
      apkg: Buffer.from('APKG BYTES'),
      cardCount: 58,
      deckName: 'notes',
      pdfFallbackMode: 'pairs',
    });
    const controller = new AiPreviewResumeController(useCaseStub(execute));
    const res = mockRes(88);

    await controller.resume(mockReq('visitor-1'), res);

    expect(execute).toHaveBeenCalledWith({
      anonymousPassId: 88,
      anonId: 'visitor-1',
      requestId: 'req-1',
    });
    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
    expect(res.set).toHaveBeenCalledWith('X-Card-Count', '58');
    expect(res.set).not.toHaveBeenCalledWith(
      'X-Pdf-Fallback',
      expect.anything()
    );
    expect((res as unknown as { body: Buffer }).body).toEqual(
      Buffer.from('APKG BYTES')
    );
  });

  it('returns 404 when no preview hold is waiting', async () => {
    const execute = vi.fn().mockRejectedValue(new NoAiPreviewHoldError());
    const controller = new AiPreviewResumeController(useCaseStub(execute));
    const res = mockRes(88);

    await controller.resume(mockReq('visitor-1'), res);

    expect((res as unknown as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns 410 when the held file has expired', async () => {
    const execute = vi.fn().mockRejectedValue(new AiPreviewHoldExpiredError());
    const controller = new AiPreviewResumeController(useCaseStub(execute));
    const res = mockRes(88);

    await controller.resume(mockReq('visitor-1'), res);

    expect((res as unknown as { statusCode: number }).statusCode).toBe(410);
  });

  it('returns 402 when the pass has no AI credits left', async () => {
    const execute = vi.fn().mockRejectedValue(new AiCreditsExhaustedError());
    const controller = new AiPreviewResumeController(useCaseStub(execute));
    const res = mockRes(88);

    await controller.resume(mockReq('visitor-1'), res);

    expect((res as unknown as { statusCode: number }).statusCode).toBe(402);
  });
});
