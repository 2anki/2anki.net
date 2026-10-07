import { vi } from 'vitest';
import {
  SendPauseResumeWarningsUseCase,
  formatAmount,
} from './SendPauseResumeWarningsUseCase';
import type {
  IPauseResumeWarningRepository,
  PausedSubscriptionRow,
} from '../../data_layer/PauseResumeWarningRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';

const NOW = new Date('2026-08-05T12:00:00Z');
const RESUMES_AT_SECONDS = Math.floor(
  new Date('2026-08-07T12:00:00Z').getTime() / 1000
);

function makePayload(
  resumesAt: number | null,
  amount: number | null = 799
): string {
  return JSON.stringify({
    pause_collection:
      resumesAt == null ? null : { behavior: 'void', resumes_at: resumesAt },
    plan: { amount, currency: 'usd' },
  });
}

class FakeRepository implements IPauseResumeWarningRepository {
  rows: PausedSubscriptionRow[] = [];
  sent = new Set<string>();
  lastWindow: [number, number] | null = null;

  async findPausedResumingBetween(from: number, to: number) {
    this.lastWindow = [from, to];
    return this.rows;
  }

  async wasSent(email: string, resumesAt: Date) {
    return this.sent.has(`${email}|${resumesAt.toISOString()}`);
  }

  async markSent(email: string, resumesAt: Date) {
    this.sent.add(`${email}|${resumesAt.toISOString()}`);
  }
}

function makeEmailService() {
  return {
    sendSubscriptionResumingSoonEmail: vi.fn().mockResolvedValue(undefined),
  } as unknown as IEmailService;
}

describe('SendPauseResumeWarningsUseCase', () => {
  it('sends one warning per paused subscription inside the 3-day window', async () => {
    const repo = new FakeRepository();
    repo.rows = [
      {
        email: 'stripe@example.com',
        linked_email: null,
        payload: makePayload(RESUMES_AT_SECONDS),
      },
    ];
    const emailService = makeEmailService();
    const useCase = new SendPauseResumeWarningsUseCase(repo, emailService);

    const result = await useCase.execute(NOW);

    expect(result.count).toBe(1);
    expect(emailService.sendSubscriptionResumingSoonEmail).toHaveBeenCalledWith(
      'stripe@example.com',
      new Date(RESUMES_AT_SECONDS * 1000),
      '$7.99'
    );
    expect(repo.lastWindow).toEqual([
      Math.floor(NOW.getTime() / 1000),
      Math.floor(NOW.getTime() / 1000) + 3 * 24 * 60 * 60,
    ]);
  });

  it('sends to the linked account email when the stripe email differs', async () => {
    const repo = new FakeRepository();
    repo.rows = [
      {
        email: 'stripe@example.com',
        linked_email: 'account@example.com',
        payload: makePayload(RESUMES_AT_SECONDS),
      },
    ];
    const emailService = makeEmailService();
    const useCase = new SendPauseResumeWarningsUseCase(repo, emailService);

    await useCase.execute(NOW);

    expect(emailService.sendSubscriptionResumingSoonEmail).toHaveBeenCalledWith(
      'account@example.com',
      expect.any(Date),
      '$7.99'
    );
  });

  it('never sends twice for the same subscription and resume date', async () => {
    const repo = new FakeRepository();
    repo.rows = [
      {
        email: 'stripe@example.com',
        linked_email: null,
        payload: makePayload(RESUMES_AT_SECONDS),
      },
    ];
    const emailService = makeEmailService();
    const useCase = new SendPauseResumeWarningsUseCase(repo, emailService);

    const first = await useCase.execute(NOW);
    const second = await useCase.execute(NOW);

    expect(first.count).toBe(1);
    expect(second.count).toBe(0);
    expect(
      emailService.sendSubscriptionResumingSoonEmail
    ).toHaveBeenCalledTimes(1);
  });

  it('skips rows whose payload has no pause_collection', async () => {
    const repo = new FakeRepository();
    repo.rows = [
      {
        email: 'stripe@example.com',
        linked_email: null,
        payload: makePayload(null),
      },
    ];
    const emailService = makeEmailService();
    const useCase = new SendPauseResumeWarningsUseCase(repo, emailService);

    const result = await useCase.execute(NOW);

    expect(result.count).toBe(0);
    expect(
      emailService.sendSubscriptionResumingSoonEmail
    ).not.toHaveBeenCalled();
  });

  it('falls back to neutral wording when the plan amount is missing', () => {
    expect(formatAmount(null, 'usd')).toBe('your regular price');
    expect(formatAmount(200, 'eur')).toBe('€2.00');
    expect(formatAmount(6400, 'usd')).toBe('$64.00');
  });
});
