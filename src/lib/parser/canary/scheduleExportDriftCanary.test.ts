import { vi } from 'vitest';
import { setupTests } from '../../../test/configure-jest';
import {
  scheduleExportDriftCanary,
  EXPORT_DRIFT_CANARY_WEEKDAY,
  EXPORT_DRIFT_CANARY_TIME_OF_DAY,
} from './scheduleExportDriftCanary';
import { nextWeeklyRunAt } from './nextWeeklyRunAt';
import type { IEmailService } from '../../../services/EmailService/EmailService';
import type { ExportDriftResult } from '../../../usecases/canary/runExportDriftCanary';

beforeEach(() => setupTests());

function makeEmailService(
  overrides: Partial<IEmailService> = {}
): IEmailService {
  return {
    sendParserCanaryAlert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IEmailService;
}

const PASS_RESULT: ExportDriftResult = { status: 'pass', failures: [] };

const FAIL_RESULT: ExportDriftResult = {
  status: 'fail',
  failures: [
    {
      driftClass: 'details.toggle (2026 export)',
      htmlPath: 'notion-details-toggle-2026.html',
      expected: {
        deckCount: 1,
        cardCount: 1,
        nonEmptyFrontCount: 1,
        nonEmptyBackCount: 1,
        mediaCount: 0,
      },
      actual: {
        deckCount: 1,
        cardCount: 0,
        nonEmptyFrontCount: 0,
        nonEmptyBackCount: 0,
        mediaCount: 0,
      },
      divergedFields: ['cardCount', 'nonEmptyFrontCount', 'nonEmptyBackCount'],
    },
  ],
};

describe('scheduleExportDriftCanary', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('returns a timeout handle immediately', () => {
    const handle = scheduleExportDriftCanary(makeEmailService(), {
      runCanary: vi.fn().mockResolvedValue(PASS_RESULT),
    });
    expect(handle).toBeDefined();
    clearTimeout(handle);
  });

  test('does not fire before the next weekly window', () => {
    const now = new Date('2026-07-14T12:00:00Z');
    const runCanary = vi.fn().mockResolvedValue(PASS_RESULT);
    const handle = scheduleExportDriftCanary(makeEmailService(), {
      now: () => now,
      runCanary,
    });

    const expected = nextWeeklyRunAt(
      EXPORT_DRIFT_CANARY_WEEKDAY,
      EXPORT_DRIFT_CANARY_TIME_OF_DAY,
      now
    );
    const delayMs = expected.getTime() - now.getTime();

    vi.advanceTimersByTime(delayMs - 1);
    expect(runCanary).not.toHaveBeenCalled();

    clearTimeout(handle);
  });

  test('sends an alert email when the canary reports drift', async () => {
    const now = new Date('2026-07-14T12:00:00Z');
    const alertMock = vi.fn().mockResolvedValue(undefined);
    const emailService = makeEmailService({ sendParserCanaryAlert: alertMock });
    const runCanary = vi.fn().mockResolvedValue(FAIL_RESULT);

    scheduleExportDriftCanary(emailService, { now: () => now, runCanary });

    await vi.runOnlyPendingTimersAsync();

    expect(alertMock).toHaveBeenCalledTimes(1);
    const [toArg, summaryArg] = alertMock.mock.calls[0] as [string, string];
    expect(typeof toArg).toBe('string');
    expect(toArg.length).toBeGreaterThan(0);
    expect(summaryArg).toContain('details.toggle');
    expect(summaryArg).toContain('Diverged fields');
  });

  test('does not send an alert email when the canary passes', async () => {
    const now = new Date('2026-07-14T12:00:00Z');
    const alertMock = vi.fn().mockResolvedValue(undefined);
    const emailService = makeEmailService({ sendParserCanaryAlert: alertMock });
    const runCanary = vi.fn().mockResolvedValue(PASS_RESULT);

    scheduleExportDriftCanary(emailService, { now: () => now, runCanary });

    await vi.runOnlyPendingTimersAsync();

    expect(alertMock).not.toHaveBeenCalled();
  });
});
