import { vi, type Mock } from 'vitest';
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
  claimed = new Set<string>();
  lastWindow: [number, number] | null = null;

  async findPausedResumingBetween(from: number, to: number) {
    this.lastWindow = [from, to];
    return this.rows;
  }

  async claimNotice(email: string, resumesAt: Date) {
    const key = `${email}|${resumesAt.toISOString()}`;
    if (this.claimed.has(key)) {
      return false;
    }
    this.claimed.add(key);
    return true;
  }

  async releaseNotice(email: string, resumesAt: Date) {
    this.claimed.delete(`${email}|${resumesAt.toISOString()}`);
  }
}

function makeEmailService() {
  return {
    sendSubscriptionResumingSoonEmail: vi.fn().mockResolvedValue(undefined),
  } as unknown as IEmailService;
}

describe('SendPauseResumeWarningsUseCase', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('sends one warning when two subscriptions with different payer emails reach one account', async () => {
    const repo = new FakeRepository();
    repo.rows = [
      {
        email: 'payer@example.com',
        linked_email: 'account@example.com',
        payload: makePayload(RESUMES_AT_SECONDS),
      },
      {
        email: 'account@example.com',
        linked_email: null,
        payload: makePayload(RESUMES_AT_SECONDS),
      },
    ];
    const emailService = makeEmailService();
    const useCase = new SendPauseResumeWarningsUseCase(repo, emailService);

    const result = await useCase.execute(NOW);

    expect(result.count).toBe(1);
    expect(
      emailService.sendSubscriptionResumingSoonEmail
    ).toHaveBeenCalledTimes(1);
    expect(emailService.sendSubscriptionResumingSoonEmail).toHaveBeenCalledWith(
      'account@example.com',
      new Date(RESUMES_AT_SECONDS * 1000),
      '$7.99'
    );
    expect([...repo.claimed]).toEqual([
      `account@example.com|${new Date(RESUMES_AT_SECONDS * 1000).toISOString()}`,
    ]);
  });

  it('warns the new address once when the account email changes after the warning went out', async () => {
    const repo = new FakeRepository();
    const row: PausedSubscriptionRow = {
      email: 'payer@example.com',
      linked_email: 'old@example.com',
      payload: makePayload(RESUMES_AT_SECONDS),
    };
    repo.rows = [row];
    const emailService = makeEmailService();
    const useCase = new SendPauseResumeWarningsUseCase(repo, emailService);

    await useCase.execute(NOW);
    row.linked_email = 'new@example.com';
    const afterChange = await useCase.execute(NOW);
    const nextDay = await useCase.execute(NOW);

    expect(afterChange.count).toBe(1);
    expect(nextDay.count).toBe(0);
    expect(
      (emailService.sendSubscriptionResumingSoonEmail as Mock).mock.calls.map(
        ([recipient]) => recipient
      )
    ).toEqual(['old@example.com', 'new@example.com']);
  });

  it('keys an unlinked subscription on its payer email, the address it is sent to', async () => {
    const repo = new FakeRepository();
    repo.rows = [
      {
        email: 'stripe@example.com',
        linked_email: null,
        payload: makePayload(RESUMES_AT_SECONDS),
      },
    ];
    const useCase = new SendPauseResumeWarningsUseCase(
      repo,
      makeEmailService()
    );

    await useCase.execute(NOW);

    expect([...repo.claimed]).toEqual([
      `stripe@example.com|${new Date(RESUMES_AT_SECONDS * 1000).toISOString()}`,
    ]);
  });

  it('releases the claim on the linked account email when its send fails, so the next run retries it', async () => {
    const repo = new FakeRepository();
    repo.rows = [
      {
        email: 'payer@example.com',
        linked_email: 'account@example.com',
        payload: makePayload(RESUMES_AT_SECONDS),
      },
    ];
    const emailService = {
      sendSubscriptionResumingSoonEmail: vi
        .fn()
        .mockRejectedValueOnce(new Error('smtp down'))
        .mockResolvedValue(undefined),
    } as unknown as IEmailService;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const useCase = new SendPauseResumeWarningsUseCase(repo, emailService);

    const first = await useCase.execute(NOW);
    expect(repo.claimed.size).toBe(0);
    const second = await useCase.execute(NOW);

    expect(first.count).toBe(0);
    expect(second.count).toBe(1);
    expect(
      emailService.sendSubscriptionResumingSoonEmail
    ).toHaveBeenLastCalledWith(
      'account@example.com',
      expect.any(Date),
      '$7.99'
    );
  });

  it('claims the notice before the email goes out, so a run cut short after the send never repeats it', async () => {
    const repo = new FakeRepository();
    repo.rows = [
      {
        email: 'stripe@example.com',
        linked_email: null,
        payload: makePayload(RESUMES_AT_SECONDS),
      },
    ];
    const claimedAtSend: boolean[] = [];
    const emailService = {
      sendSubscriptionResumingSoonEmail: vi.fn(async () => {
        claimedAtSend.push(repo.claimed.size === 1);
      }),
    } as unknown as IEmailService;
    const useCase = new SendPauseResumeWarningsUseCase(repo, emailService);

    await useCase.execute(NOW);

    expect(claimedAtSend).toEqual([true]);
  });

  it('releases the claim when a send fails, so the next run retries it', async () => {
    const repo = new FakeRepository();
    repo.rows = [
      {
        email: 'first@example.com',
        linked_email: null,
        payload: makePayload(RESUMES_AT_SECONDS),
      },
      {
        email: 'second@example.com',
        linked_email: null,
        payload: makePayload(RESUMES_AT_SECONDS),
      },
    ];
    const emailService = {
      sendSubscriptionResumingSoonEmail: vi
        .fn()
        .mockRejectedValueOnce(new Error('smtp down'))
        .mockResolvedValue(undefined),
    } as unknown as IEmailService;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const useCase = new SendPauseResumeWarningsUseCase(repo, emailService);

    const first = await useCase.execute(NOW);
    const second = await useCase.execute(NOW);

    expect(first.count).toBe(1);
    expect(second.count).toBe(1);
    expect(
      emailService.sendSubscriptionResumingSoonEmail
    ).toHaveBeenCalledTimes(3);
    expect(
      emailService.sendSubscriptionResumingSoonEmail
    ).toHaveBeenLastCalledWith('first@example.com', expect.any(Date), '$7.99');
  });

  it('logs the send failure, not the address, when releasing the claim also fails', async () => {
    const repo = new FakeRepository();
    repo.rows = [
      {
        email: 'first@example.com',
        linked_email: null,
        payload: makePayload(RESUMES_AT_SECONDS),
      },
      {
        email: 'second@example.com',
        linked_email: null,
        payload: makePayload(RESUMES_AT_SECONDS),
      },
    ];
    repo.releaseNotice = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "delete from pause_resume_warnings where subscription_email = 'first@example.com'"
        )
      );
    const emailService = {
      sendSubscriptionResumingSoonEmail: vi
        .fn()
        .mockRejectedValueOnce(new Error('smtp down'))
        .mockResolvedValue(undefined),
    } as unknown as IEmailService;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const useCase = new SendPauseResumeWarningsUseCase(repo, emailService);

    const result = await useCase.execute(NOW);

    expect(result.count).toBe(1);
    expect(errorLog).toHaveBeenCalledWith(
      '[pause-resume-warnings] failed to send a warning:',
      'smtp down'
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      'first@example.com'
    );
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
