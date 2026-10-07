import { vi } from 'vitest';
import { setupTests } from '../../../test/configure-jest';
import {
  scheduleParserCanary,
  PARSER_CANARY_TIME_OF_DAY,
  PARSER_CANARY_TIMEZONE,
} from './scheduleParserCanary';
import { nextDailyRunAt } from '../../ankify/nextDailyRunAt';
import type { IEmailService } from '../../../services/EmailService/EmailService';
import type { CanaryResult } from '../../../usecases/canary/runParserCanary';

beforeEach(() => setupTests());

function makeEmailService(
  overrides: Partial<IEmailService> = {}
): IEmailService {
  return {
    sendResetEmail: vi.fn(),
    sendConversionEmail: vi.fn(),
    sendConversionLinkEmail: vi.fn(),
    sendContactEmail: vi.fn(),
    sendSubscriptionCancelledEmail: vi.fn(),
    sendSubscriptionScheduledCancellationEmail: vi.fn(),
    sendHostedAnkiAccessRequestEmail: vi.fn(),
    sendMagicLinkEmail: vi.fn(),
    sendReEngagementEmail: vi.fn(),
    sendInactivityWarningEmail: vi.fn(),
    sendAbandonedCheckoutRecoveryEmail: vi.fn(),
    sendParserCanaryAlert: vi.fn().mockResolvedValue(undefined),
    sendNotionReconnectEmail: vi.fn().mockResolvedValue(undefined),
    sendSubscriptionClaimConfirmation: vi.fn().mockResolvedValue(undefined),
    sendPassClaimConfirmation: vi.fn().mockResolvedValue(undefined),
    sendPriceLockInEmail: vi.fn().mockResolvedValue(undefined),
    sendSubscriptionRecoveryEmail: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IEmailService;
}

const PASS_RESULT: CanaryResult = { status: 'pass', failures: [] };

const FAIL_RESULT: CanaryResult = {
  status: 'fail',
  failures: [
    {
      fixtureName: 'notion-html-2024',
      expected: { cardCount: 9999, imageCount: 9999, clozeCount: 9999 },
      actual: { cardCount: 3, imageCount: 1, clozeCount: 3 },
    },
  ],
};

describe('scheduleParserCanary', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('returns a timeout handle immediately', () => {
    const handle = scheduleParserCanary(makeEmailService(), {
      runCanary: vi.fn().mockResolvedValue(PASS_RESULT),
    });
    expect(handle).toBeDefined();
    clearTimeout(handle);
  });

  test('does not fire before the next 03:00 UTC window', () => {
    const now = new Date('2026-05-18T01:00:00Z');
    const runCanary = vi.fn().mockResolvedValue(PASS_RESULT);
    const handle = scheduleParserCanary(makeEmailService(), {
      now: () => now,
      runCanary,
    });

    const expected = nextDailyRunAt(
      PARSER_CANARY_TIME_OF_DAY,
      PARSER_CANARY_TIMEZONE,
      now
    );
    const delayMs = expected.getTime() - now.getTime();

    vi.advanceTimersByTime(delayMs - 1);
    expect(runCanary).not.toHaveBeenCalled();

    clearTimeout(handle);
  });

  test('sends an alert email when the canary reports a failure', async () => {
    const now = new Date('2026-05-18T01:00:00Z');
    const alertMock = vi.fn().mockResolvedValue(undefined);
    const emailService = makeEmailService({ sendParserCanaryAlert: alertMock });
    const runCanary = vi.fn().mockResolvedValue(FAIL_RESULT);

    scheduleParserCanary(emailService, { now: () => now, runCanary });

    await vi.runOnlyPendingTimersAsync();

    expect(alertMock).toHaveBeenCalledTimes(1);
    const [toArg, summaryArg] = alertMock.mock.calls[0] as [string, string];
    expect(typeof toArg).toBe('string');
    expect(toArg.length).toBeGreaterThan(0);
    expect(summaryArg).toContain('notion-html-2024');
    expect(summaryArg).toContain('9999');
  });

  test('does not send an alert email when the canary passes', async () => {
    const now = new Date('2026-05-18T01:00:00Z');
    const alertMock = vi.fn().mockResolvedValue(undefined);
    const emailService = makeEmailService({ sendParserCanaryAlert: alertMock });
    const runCanary = vi.fn().mockResolvedValue(PASS_RESULT);

    scheduleParserCanary(emailService, { now: () => now, runCanary });

    await vi.runOnlyPendingTimersAsync();

    expect(alertMock).not.toHaveBeenCalled();
  });
});
