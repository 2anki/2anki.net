import { vi, type Mocked } from 'vitest';
import { Request, Response } from 'express';

import FeatureInterestController from './FeatureInterestController';
import { IFeatureInterestRepository } from '../data_layer/FeatureInterestRepository';

function buildMocks() {
  const repo: Mocked<IFeatureInterestRepository> = {
    record: vi.fn().mockResolvedValue(undefined),
    countByFeatureKey: vi.fn().mockResolvedValue([]),
  };
  const controller = new FeatureInterestController(repo);
  const req = { body: {}, cookies: {} } as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    locals: {},
  } as unknown as Response;
  return { repo, controller, req, res };
}

describe('FeatureInterestController', () => {
  it('returns 400 when the feature key is unknown', async () => {
    const { controller, req, res, repo } = buildMocks();
    req.body = { feature_key: 'not_a_real_feature' };
    await controller.record(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(repo.record).not.toHaveBeenCalled();
  });

  it('returns 400 when the feature key is missing', async () => {
    const { controller, req, res, repo } = buildMocks();
    req.body = {};
    await controller.record(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(repo.record).not.toHaveBeenCalled();
  });

  it('records interest for a known key from an anonymous visitor', async () => {
    const { controller, req, res, repo } = buildMocks();
    req.body = { feature_key: 'study_reminders' };
    (req.cookies as Record<string, unknown>).anon_id = 'anon-123';
    await controller.record(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.record).toHaveBeenCalledWith({
      feature_key: 'study_reminders',
      user_id: null,
      anonymous_id: 'anon-123',
      comment: null,
    });
  });

  it('attaches the logged-in user id from res.locals.owner', async () => {
    const { controller, req, res, repo } = buildMocks();
    req.body = { feature_key: 'deck_folders' };
    (res.locals as Record<string, unknown>).owner = 77;
    await controller.record(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.record.mock.calls[0][0].user_id).toBe(77);
  });

  it('stores a trimmed comment when provided', async () => {
    const { controller, req, res, repo } = buildMocks();
    req.body = {
      feature_key: 'study_reminders',
      comment: '  would use daily  ',
    };
    await controller.record(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.record.mock.calls[0][0].comment).toBe('would use daily');
  });

  it('truncates a long comment to 280 characters', async () => {
    const { controller, req, res, repo } = buildMocks();
    req.body = {
      feature_key: 'study_reminders',
      comment: 'x'.repeat(500),
    };
    await controller.record(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.record.mock.calls[0][0].comment).toHaveLength(280);
  });

  it('stores a null comment when only whitespace is provided', async () => {
    const { controller, req, res, repo } = buildMocks();
    req.body = { feature_key: 'study_reminders', comment: '   ' };
    await controller.record(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.record.mock.calls[0][0].comment).toBeNull();
  });

  it('returns 500 when the repository throws', async () => {
    const { controller, req, res, repo } = buildMocks();
    repo.record.mockRejectedValueOnce(new Error('db error'));
    req.body = { feature_key: 'study_reminders' };
    await controller.record(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
