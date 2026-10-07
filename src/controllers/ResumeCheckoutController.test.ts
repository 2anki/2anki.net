import { vi, type Mocked } from 'vitest';
import type { Request, Response } from 'express';
import ResumeCheckoutController from './ResumeCheckoutController';
import { ResumeAbandonedCheckoutUseCase } from '../usecases/checkout/ResumeAbandonedCheckoutUseCase';
import { InMemoryAbandonedCheckoutRecoveryRepository } from '../data_layer/AbandonedCheckoutRecoveryRepository';
import type { EventsSink } from '../services/events/EventsSink';

const TOKEN = 'f4b3a070-1f2e-4c3d-9a8b-7c6d5e4f3a2b';
const STRIPE_URL = 'https://buy.stripe.com/r/live_abc123';
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

function makeRes(): Mocked<Pick<Response, 'redirect'>> {
  return { redirect: vi.fn() } as unknown as Mocked<Pick<Response, 'redirect'>>;
}

function makeReq(token?: unknown): Request {
  return { query: { token } } as unknown as Request;
}

describe('ResumeCheckoutController', () => {
  let repo: InMemoryAbandonedCheckoutRecoveryRepository;
  let controller: ResumeCheckoutController;
  let eventsSink: Mocked<Pick<EventsSink, 'record'>>;

  beforeEach(() => {
    repo = new InMemoryAbandonedCheckoutRecoveryRepository();
    eventsSink = { record: vi.fn() };
    controller = new ResumeCheckoutController(
      new ResumeAbandonedCheckoutUseCase(repo),
      eventsSink
    );
  });

  it('302s to the Stripe recovery URL for a valid token', async () => {
    await repo.claimSession('cs_1', 'alice@example.com', TOKEN, {
      url: STRIPE_URL,
      expiresAt: FUTURE,
    });
    const res = makeRes();

    await controller.resume(makeReq(TOKEN), res as unknown as Response);

    expect(res.redirect).toHaveBeenCalledWith(302, STRIPE_URL);
  });

  it('302s to pricing when the token is unknown', async () => {
    const res = makeRes();

    await controller.resume(makeReq(TOKEN), res as unknown as Response);

    expect(res.redirect).toHaveBeenCalledWith(302, '/pricing?from=recovery');
  });

  it('302s to pricing when the token is missing', async () => {
    const res = makeRes();

    await controller.resume(makeReq(undefined), res as unknown as Response);

    expect(res.redirect).toHaveBeenCalledWith(302, '/pricing?from=recovery');
  });

  it('records an email_clicked event with resumed true on success', async () => {
    await repo.claimSession('cs_1', 'alice@example.com', TOKEN, {
      url: STRIPE_URL,
      expiresAt: FUTURE,
    });

    await controller.resume(makeReq(TOKEN), makeRes() as unknown as Response);

    expect(eventsSink.record).toHaveBeenCalledWith({
      name: 'email_clicked',
      props: { campaign: 'abandoned_checkout', resumed: true },
    });
  });

  it('records an email_clicked event with resumed false on fallback', async () => {
    await controller.resume(makeReq(TOKEN), makeRes() as unknown as Response);

    expect(eventsSink.record).toHaveBeenCalledWith({
      name: 'email_clicked',
      props: { campaign: 'abandoned_checkout', resumed: false },
    });
  });
});
