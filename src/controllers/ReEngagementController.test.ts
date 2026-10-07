import { vi, type Mocked } from 'vitest';
import { Request, Response } from 'express';

import { ReEngagementController } from './ReEngagementController';
import type { IReEngagementRepository } from '../data_layer/ReEngagementRepository';
import type { IEmailPreferencesRepository } from '../data_layer/EmailPreferencesRepository';

function buildMocks() {
  const repo: Mocked<IReEngagementRepository> = {
    hasBeenSent: vi.fn().mockResolvedValue(false),
    recordSend: vi.fn().mockResolvedValue(1),
    saveResponse: vi.fn().mockResolvedValue(undefined),
    findByToken: vi.fn().mockResolvedValue(null),
    getUsersToEmail: vi.fn().mockResolvedValue([]),
  };
  const prefRepo: Mocked<IEmailPreferencesRepository> = {
    isOptedOut: vi.fn().mockResolvedValue(false),
    optOut: vi.fn().mockResolvedValue(undefined),
    optIn: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new ReEngagementController(repo, prefRepo);
  const req = { body: {}, query: {} } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { repo, prefRepo, controller, req, res };
}

describe('ReEngagementController.validateToken', () => {
  it('returns 400 when uid is missing', async () => {
    const { controller, req, res } = buildMocks();
    await controller.validateToken(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when token is not found', async () => {
    const { controller, req, res } = buildMocks();
    (req as unknown as { query: Record<string, string> }).query = {
      uid: 'unknown-token',
    };
    await controller.validateToken(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 200 with emailId when token is valid', async () => {
    const { controller, req, res, repo } = buildMocks();
    repo.findByToken.mockResolvedValueOnce({ id: 42, userId: 7 });
    (req as unknown as { query: Record<string, string> }).query = {
      uid: 'valid-token',
    };
    await controller.validateToken(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ valid: true, emailId: 42 });
  });
});

describe('ReEngagementController.submitFeedback', () => {
  it('returns 400 when token is missing', async () => {
    const { controller, req, res } = buildMocks();
    req.body = { stoppedReason: 'Other', contentType: 'Notion' };
    await controller.submitFeedback(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when stoppedReason is missing', async () => {
    const { controller, req, res } = buildMocks();
    req.body = { token: 'abc', contentType: 'Notion' };
    await controller.submitFeedback(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when contentType is missing', async () => {
    const { controller, req, res } = buildMocks();
    req.body = { token: 'abc', stoppedReason: 'Other' };
    await controller.submitFeedback(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when token is not found', async () => {
    const { controller, req, res } = buildMocks();
    req.body = {
      token: 'bad-token',
      stoppedReason: 'Other',
      contentType: 'Notion',
    };
    await controller.submitFeedback(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 200 and saves response when token is valid', async () => {
    const { controller, req, res, repo } = buildMocks();
    repo.findByToken.mockResolvedValue({ id: 5, userId: 3 });
    req.body = {
      token: 'valid-token',
      stoppedReason: "Didn't have content ready",
      contentType: 'Notion',
      comment: 'Great tool!',
    };
    await controller.submitFeedback(req, res);
    expect(repo.saveResponse).toHaveBeenCalledWith(
      5,
      "Didn't have content ready",
      'Notion',
      'Great tool!'
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('passes null comment when comment is absent', async () => {
    const { controller, req, res, repo } = buildMocks();
    repo.findByToken.mockResolvedValue({ id: 5, userId: 3 });
    req.body = {
      token: 'valid-token',
      stoppedReason: 'Other',
      contentType: 'PDF',
    };
    await controller.submitFeedback(req, res);
    expect(repo.saveResponse).toHaveBeenCalledWith(5, 'Other', 'PDF', null);
  });
});

describe('ReEngagementController.unsubscribe', () => {
  it('returns 400 when uid is missing', async () => {
    const { controller, req, res } = buildMocks();
    await controller.unsubscribe(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when token is not found', async () => {
    const { controller, req, res } = buildMocks();
    (req as unknown as { query: Record<string, string> }).query = {
      uid: 'no-such-token',
    };
    await controller.unsubscribe(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 200 and calls optOut when token is valid', async () => {
    const { controller, req, res, repo, prefRepo } = buildMocks();
    repo.findByToken.mockResolvedValueOnce({ id: 9, userId: 5 });
    (req as unknown as { query: Record<string, string> }).query = {
      uid: 'unsub-token',
    };
    await controller.unsubscribe(req, res);
    expect(prefRepo.optOut).toHaveBeenCalledWith(5);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
