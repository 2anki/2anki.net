import { vi, type Mocked } from 'vitest';
import { Request, Response } from 'express';

import EmojiFeedbackController from './EmojiFeedbackController';
import { IEmojiFeedbackRepository } from '../data_layer/EmojiFeedbackRepository';
import type { ILowRatingContextRepository } from '../data_layer/LowRatingContextRepository';
import type { IEmailService } from '../services/EmailService/EmailService';
import { InMemoryRateLimiter } from '../lib/rateLimit/InMemoryRateLimiter';
import { NotifyLowRatingUseCase } from '../usecases/feedback/NotifyLowRatingUseCase';

function buildMocks() {
  const repo: Mocked<IEmojiFeedbackRepository> = {
    insert: vi.fn().mockResolvedValue(undefined),
    countByRating: vi.fn().mockResolvedValue([]),
    recentComments: vi.fn().mockResolvedValue([]),
    countLowRatingsFromEmailOnDay: vi.fn().mockResolvedValue(1),
  };
  const contextRepo: Mocked<ILowRatingContextRepository> = {
    getByOwner: vi.fn().mockResolvedValue(null),
  };
  const sendLowRatingFeedbackEmail = vi.fn().mockResolvedValue(undefined);
  const emailService = {
    sendLowRatingFeedbackEmail,
  } as unknown as IEmailService;
  const rateLimiter = new InMemoryRateLimiter({
    windowMs: 60 * 60 * 1000,
    perKeyMax: 100,
    globalMax: 100,
  });
  const notifier = new NotifyLowRatingUseCase(
    repo,
    contextRepo,
    emailService,
    rateLimiter
  );
  const controller = new EmojiFeedbackController(repo, notifier);
  const req = { body: {} } as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return {
    repo,
    contextRepo,
    sendLowRatingFeedbackEmail,
    controller,
    req,
    res,
  };
}

describe('EmojiFeedbackController', () => {
  it('returns 400 when rating is missing', async () => {
    const { controller, req, res } = buildMocks();
    req.body = { page: '/upload' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when rating is out of range', async () => {
    const { controller, req, res } = buildMocks();
    req.body = { rating: 6, page: '/upload' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when rating is not an integer', async () => {
    const { controller, req, res } = buildMocks();
    req.body = { rating: 3.5, page: '/upload' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when page is missing', async () => {
    const { controller, req, res } = buildMocks();
    req.body = { rating: 3 };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 201 with valid rating and page', async () => {
    const { controller, req, res, repo } = buildMocks();
    req.body = { rating: 4, page: '/upload' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.insert).toHaveBeenCalledWith({
      rating: 4,
      comment: null,
      page: '/upload',
      email: null,
    });
  });

  it('passes comment when provided', async () => {
    const { controller, req, res, repo } = buildMocks();
    req.body = { rating: 5, page: '/notion', comment: 'Great tool!' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.insert).toHaveBeenCalledWith({
      rating: 5,
      comment: 'Great tool!',
      page: '/notion',
      email: null,
    });
  });

  it('stores null email when none is provided', async () => {
    const { controller, req, res, repo } = buildMocks();
    req.body = { rating: 4, page: '/whats-new' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.insert.mock.calls[0][0].email).toBeNull();
  });

  it('persists a trimmed valid email when provided', async () => {
    const { controller, req, res, repo } = buildMocks();
    req.body = {
      rating: 5,
      page: '/whats-new',
      email: '  learner@example.com  ',
    };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.insert.mock.calls[0][0].email).toBe('learner@example.com');
  });

  it('stores null when the email is malformed', async () => {
    const { controller, req, res, repo } = buildMocks();
    req.body = { rating: 3, page: '/whats-new', email: 'not-an-email' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(repo.insert.mock.calls[0][0].email).toBeNull();
  });

  it('truncates long comments to 2000 chars', async () => {
    const { controller, req, res, repo } = buildMocks();
    const longComment = 'x'.repeat(3000);
    req.body = { rating: 3, page: '/upload', comment: longComment };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    const insertCall = repo.insert.mock.calls[0][0];
    expect(insertCall.comment).toHaveLength(2000);
  });

  it('returns 500 when repository throws and does not notify', async () => {
    const { controller, req, res, repo, sendLowRatingFeedbackEmail } =
      buildMocks();
    repo.insert.mockRejectedValueOnce(new Error('db error'));
    req.body = { rating: 2, page: '/upload', email: 'learner@example.com' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(sendLowRatingFeedbackEmail).not.toHaveBeenCalled();
  });

  it('emails support when a low rating leaves an email', async () => {
    const { controller, req, res, sendLowRatingFeedbackEmail } = buildMocks();
    req.body = {
      rating: 1,
      page: '/upload',
      comment: 'cards are wrong',
      email: 'learner@example.com',
    };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledTimes(1);
    expect(sendLowRatingFeedbackEmail.mock.calls[0][0]).toMatchObject({
      rating: 1,
      comment: 'cards are wrong',
      page: '/upload',
      replyTo: 'learner@example.com',
      emailVerified: false,
    });
  });

  it('does not email a satisfied rating that leaves an email', async () => {
    const { controller, req, res, sendLowRatingFeedbackEmail } = buildMocks();
    req.body = { rating: 5, page: '/upload', email: 'learner@example.com' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(sendLowRatingFeedbackEmail).not.toHaveBeenCalled();
  });

  it('does not email a low rating without an email', async () => {
    const { controller, req, res, sendLowRatingFeedbackEmail } = buildMocks();
    req.body = { rating: 2, page: '/upload' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(sendLowRatingFeedbackEmail).not.toHaveBeenCalled();
  });

  it('folds a second same-day low rating from the same email', async () => {
    const { controller, req, res, repo, sendLowRatingFeedbackEmail } =
      buildMocks();
    repo.countLowRatingsFromEmailOnDay.mockResolvedValue(2);
    req.body = { rating: 1, page: '/upload', email: 'learner@example.com' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(sendLowRatingFeedbackEmail).not.toHaveBeenCalled();
  });

  it('still returns 201 when the support email fails', async () => {
    const { controller, req, res, sendLowRatingFeedbackEmail } = buildMocks();
    sendLowRatingFeedbackEmail.mockRejectedValueOnce(
      new Error('sendgrid down')
    );
    req.body = { rating: 1, page: '/upload', email: 'learner@example.com' };
    await controller.submit(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(sendLowRatingFeedbackEmail).toHaveBeenCalledTimes(1);
  });
});
