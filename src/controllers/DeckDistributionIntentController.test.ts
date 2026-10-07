import { vi } from 'vitest';
import { Request, Response } from 'express';

import DeckDistributionIntentController from './DeckDistributionIntentController';
import { InMemoryDeckDistributionIntentRepository } from '../data_layer/DeckDistributionIntentRepository';

function buildMocks(owner: number | null = 42) {
  const repo = new InMemoryDeckDistributionIntentRepository();
  const controller = new DeckDistributionIntentController(repo);
  const req = { body: {} } as Request;
  const res = {
    locals: { owner: owner ?? undefined },
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { repo, controller, req, res };
}

describe('DeckDistributionIntentController', () => {
  it('returns 400 when the answer is not in the allowlist', async () => {
    const { controller, req, res } = buildMocks();
    req.body = { answer: 'marketplace', upload_key: 'deck.apkg' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when upload_key is missing', async () => {
    const { controller, req, res } = buildMocks();
    req.body = { answer: 'students' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 401 when there is no authenticated owner', async () => {
    const { controller, req, res } = buildMocks(null);
    req.body = { answer: 'students', upload_key: 'deck.apkg' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('records the intent and returns 201 for a valid submission', async () => {
    const { controller, req, res, repo } = buildMocks(42);
    req.body = { answer: 'study_group', upload_key: 'deck-abc.apkg' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.all()).toEqual([
      {
        user_id: 42,
        answer: 'study_group',
        upload_key: 'deck-abc.apkg',
        notify_email: null,
      },
    ]);
  });

  it('stores a trimmed valid notify email', async () => {
    const { controller, req, res, repo } = buildMocks(42);
    req.body = {
      answer: 'customers',
      upload_key: 'deck.apkg',
      notify_email: '  learner@example.com  ',
    };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.all()[0].notify_email).toBe('learner@example.com');
  });

  it('stores null when the notify email is malformed', async () => {
    const { controller, req, res, repo } = buildMocks(42);
    req.body = {
      answer: 'just_me',
      upload_key: 'deck.apkg',
      notify_email: 'not-an-email',
    };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.all()[0].notify_email).toBeNull();
  });
});
