import type {
  IMetricTripwireRepository,
  RateCountsRow,
  TripwireMetricKey,
} from '../../data_layer/MetricTripwireRepository';
import { evaluateRateDrop } from '../../lib/observability/tripwire/evaluateRateDrop';
import {
  TRIPWIRE_METRICS,
  type TripwireMetric,
} from '../../lib/observability/tripwire/tripwireMetrics';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_DAYS = 7;

export interface MetricTripwireRunResult {
  day: string;
  tripped: TripwireMetricKey[];
}

interface DroppedMetric {
  metric: TripwireMetric;
  day: RateCountsRow;
  baseline: RateCountsRow;
  relativeDrop: number;
}

function startOfUtcDay(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
  );
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function describeRate(counts: RateCountsRow): string {
  return `${percent(counts.numerator / counts.denominator)} (${counts.numerator}/${counts.denominator})`;
}

function formatAlertBody(day: string, dropped: DroppedMetric[]): string {
  const sections = dropped.map(
    (entry) =>
      `${entry.metric.label} (${entry.metric.key})\n` +
      `  ${day}: ${entry.day.numerator}/${entry.day.denominator} (${percent(entry.day.numerator / entry.day.denominator)}), ` +
      `baseline ${describeRate(entry.baseline)} over the ${BASELINE_DAYS} days before, ` +
      `a ${percent(entry.relativeDrop)} relative drop\n` +
      `  Source: ${entry.metric.source}`
  );
  return (
    `These rates fell on ${day} (UTC) by more than their threshold, and by more than chance explains at that volume.\n\n` +
    `${sections.join('\n\n')}\n\n` +
    `Check what deployed on ${day} and the day before. Each metric alerts at most once per day; ` +
    `a regression that persists will stop alerting once it is part of the ${BASELINE_DAYS}-day baseline.`
  );
}

export class RunMetricTripwireUseCase {
  constructor(
    private readonly repository: IMetricTripwireRepository,
    private readonly sendAlert: (
      subject: string,
      body: string
    ) => Promise<void>,
    private readonly log: (line: string) => void = (line) => console.info(line)
  ) {}

  async execute(now: Date): Promise<MetricTripwireRunResult> {
    const dayEnd = startOfUtcDay(now);
    const dayStart = new Date(dayEnd.getTime() - DAY_MS);
    const baselineStart = new Date(dayStart.getTime() - BASELINE_DAYS * DAY_MS);
    const dayLabel = dayStart.toISOString().slice(0, 10);

    const dayCounts = await this.repository.countRates(dayStart, dayEnd);
    const baselineCounts = await this.repository.countRates(
      baselineStart,
      dayStart
    );

    const dropped: DroppedMetric[] = [];
    for (const metric of TRIPWIRE_METRICS) {
      const day = dayCounts[metric.key];
      const baseline = baselineCounts[metric.key];
      const verdict = evaluateRateDrop(day, baseline, metric.minRelativeDrop);
      if (verdict.kind === 'underpowered') {
        this.log(
          `[metric-tripwire] day=${dayLabel} metric=${metric.key} verdict=underpowered window=${verdict.window} day_n=${day.denominator} baseline_n=${baseline.denominator}`
        );
        continue;
      }
      this.log(
        `[metric-tripwire] day=${dayLabel} metric=${metric.key} verdict=${verdict.kind} day=${day.numerator}/${day.denominator} baseline=${baseline.numerator}/${baseline.denominator} drop=${verdict.relativeDrop.toFixed(3)} p=${verdict.tailProbability.toExponential(2)}`
      );
      if (verdict.kind === 'dropped') {
        dropped.push({
          metric,
          day,
          baseline,
          relativeDrop: verdict.relativeDrop,
        });
      }
    }

    const fresh: DroppedMetric[] = [];
    for (const entry of dropped) {
      if (!(await this.repository.hasAlerted(entry.metric.key, dayLabel))) {
        fresh.push(entry);
      }
    }

    if (fresh.length > 0) {
      await this.alert(dayLabel, fresh);
    }

    await this.repository.recordCheck(dayLabel, dropped.length);
    return {
      day: dayLabel,
      tripped: dropped.map((entry) => entry.metric.key),
    };
  }

  private async alert(day: string, fresh: DroppedMetric[]): Promise<void> {
    const noun = fresh.length === 1 ? 'rate' : 'rates';
    try {
      await this.sendAlert(
        `[2anki] Metric tripwire: ${fresh.length} ${noun} dropped on ${day}`,
        formatAlertBody(day, fresh)
      );
    } catch (error) {
      console.error('[metric-tripwire] alert email failed:', error);
      return;
    }
    for (const entry of fresh) {
      await this.repository.recordAlert(entry.metric.key, day);
    }
  }
}
