import { vi } from 'vitest';

import type {
  IMetricTripwireRepository,
  TripwireMetricKey,
  TripwireRateCounts,
} from '../../data_layer/MetricTripwireRepository';
import { RunMetricTripwireUseCase } from './RunMetricTripwireUseCase';

const NOW = new Date('2026-03-11T06:30:00.000Z');
const DAY_START = '2026-03-10T00:00:00.000Z';
const BASELINE_START = '2026-03-03T00:00:00.000Z';

function steadyCounts(scale: number): TripwireRateCounts {
  return {
    conversion_success: { numerator: 90 * scale, denominator: 100 * scale },
    deck_has_cards: { numerator: 95 * scale, denominator: 100 * scale },
    download_after_success: {
      numerator: 80 * scale,
      denominator: 100 * scale,
    },
    upload_after_page_view: {
      numerator: 60 * scale,
      denominator: 100 * scale,
    },
    partial_notice_signed_in: {
      numerator: 8 * scale,
      denominator: 10 * scale,
    },
    partial_notice_anonymous: {
      numerator: 80 * scale,
      denominator: 100 * scale,
    },
  };
}

class FakeTripwireRepository implements IMetricTripwireRepository {
  readonly alerts: Array<{ metric: TripwireMetricKey; day: string }> = [];
  readonly checks: Array<{ day: string; tripped: number }> = [];
  readonly windows: Array<{ start: string; end: string }> = [];

  constructor(
    private readonly day: TripwireRateCounts,
    private readonly baseline: TripwireRateCounts
  ) {}

  async countRates(start: Date, end: Date): Promise<TripwireRateCounts> {
    this.windows.push({
      start: start.toISOString(),
      end: end.toISOString(),
    });
    return start.toISOString() === DAY_START ? this.day : this.baseline;
  }

  async lastCheckedAt(): Promise<Date | null> {
    return null;
  }

  async hasAlerted(metric: TripwireMetricKey, day: string): Promise<boolean> {
    return this.alerts.some((a) => a.metric === metric && a.day === day);
  }

  async recordAlert(metric: TripwireMetricKey, day: string): Promise<void> {
    this.alerts.push({ metric, day });
  }

  async recordCheck(day: string, tripped: number): Promise<void> {
    this.checks.push({ day, tripped });
  }
}

function build(day: TripwireRateCounts, baseline = steadyCounts(7)) {
  const repository = new FakeTripwireRepository(day, baseline);
  const sendAlert = vi.fn().mockResolvedValue(undefined);
  const useCase = new RunMetricTripwireUseCase(repository, sendAlert, () => {});
  return { repository, sendAlert, useCase };
}

describe('RunMetricTripwireUseCase', () => {
  it('compares yesterday against the seven UTC days before it', async () => {
    const { repository, useCase } = build(steadyCounts(1));

    await useCase.execute(NOW);

    expect(repository.windows).toEqual([
      { start: DAY_START, end: '2026-03-11T00:00:00.000Z' },
      { start: BASELINE_START, end: DAY_START },
    ]);
  });

  it('sends nothing and records a clean check when every rate holds', async () => {
    const { repository, sendAlert, useCase } = build(steadyCounts(1));

    const result = await useCase.execute(NOW);

    expect(sendAlert).not.toHaveBeenCalled();
    expect(result.tripped).toEqual([]);
    expect(repository.checks).toEqual([{ day: '2026-03-10', tripped: 0 }]);
  });

  it('emails ops when the signed-in partial notice disappears', async () => {
    const day = steadyCounts(1);
    day.partial_notice_signed_in = { numerator: 0, denominator: 10 };
    const { repository, sendAlert, useCase } = build(day);

    const result = await useCase.execute(NOW);

    expect(result.tripped).toEqual(['partial_notice_signed_in']);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    const [subject, body] = sendAlert.mock.calls[0];
    expect(subject).toBe(
      '[2anki] Metric tripwire: 1 rate dropped on 2026-03-10'
    );
    expect(body).toContain(
      'Signed-in over-limit uploads that showed the held-back notice'
    );
    expect(body).toContain('0/10 (0.0%)');
    expect(body).toContain('baseline 80.0% (56/70)');
    expect(body).toContain('card_limit_partial');
    expect(repository.alerts).toEqual([
      { metric: 'partial_notice_signed_in', day: '2026-03-10' },
    ]);
    expect(repository.checks).toEqual([{ day: '2026-03-10', tripped: 1 }]);
  });

  it('stays quiet when the same collapse happens on too few rows to show it', async () => {
    const day = steadyCounts(1);
    day.partial_notice_signed_in = { numerator: 0, denominator: 3 };
    const { sendAlert, useCase } = build(day);

    const result = await useCase.execute(NOW);

    expect(sendAlert).not.toHaveBeenCalled();
    expect(result.tripped).toEqual([]);
  });

  it('alerts once per metric per day across repeated runs', async () => {
    const day = steadyCounts(5);
    day.conversion_success = { numerator: 300, denominator: 500 };
    const { repository, sendAlert, useCase } = build(day);

    await useCase.execute(NOW);
    await useCase.execute(new Date('2026-03-11T18:30:00.000Z'));

    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(repository.alerts).toEqual([
      { metric: 'conversion_success', day: '2026-03-10' },
    ]);
  });

  it('puts every newly dropped metric in one email', async () => {
    const day = steadyCounts(5);
    day.conversion_success = { numerator: 300, denominator: 500 };
    day.download_after_success = { numerator: 200, denominator: 500 };
    const { sendAlert, useCase } = build(day);

    const result = await useCase.execute(NOW);

    expect(result.tripped).toEqual([
      'conversion_success',
      'download_after_success',
    ]);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert.mock.calls[0][0]).toBe(
      '[2anki] Metric tripwire: 2 rates dropped on 2026-03-10'
    );
  });

  it('leaves the alert unrecorded when the email fails so the next run retries', async () => {
    const day = steadyCounts(5);
    day.conversion_success = { numerator: 300, denominator: 500 };
    const { repository, sendAlert, useCase } = build(day);
    sendAlert.mockRejectedValueOnce(new Error('smtp down'));

    await useCase.execute(NOW);
    await useCase.execute(new Date('2026-03-11T18:30:00.000Z'));

    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(repository.alerts).toEqual([
      { metric: 'conversion_success', day: '2026-03-10' },
    ]);
  });
});
