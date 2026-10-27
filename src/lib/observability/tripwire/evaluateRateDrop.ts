export interface RateCounts {
  numerator: number;
  denominator: number;
}

// Below five rows a day cannot show even a total collapse at the tail
// probability below unless the baseline rate is above 75%: 0.25^5 < 0.001.
export const TRIPWIRE_MIN_DAY_DENOMINATOR = 5;

// Thirty rows keep the baseline rate's own standard error at or under nine
// points, so a drop the gate accepts is not an artefact of a noisy baseline.
export const TRIPWIRE_MIN_BASELINE_DENOMINATOR = 30;

// The chance that yesterday's count is this low if the baseline rate still
// held. One in a thousand per metric per day keeps chance alerts across the
// whole metric set to a few a year.
export const TRIPWIRE_MAX_TAIL_PROBABILITY = 0.001;

export type RateDropVerdict =
  | { kind: 'underpowered'; window: 'day' | 'baseline' }
  | {
      kind: 'steady' | 'dropped';
      dayRate: number;
      baselineRate: number;
      relativeDrop: number;
      tailProbability: number;
    };

function logSumExp(values: number[]): number {
  const max = Math.max(...values);
  if (max === -Infinity) return -Infinity;
  let sum = 0;
  for (const value of values) {
    sum += Math.exp(value - max);
  }
  return max + Math.log(sum);
}

export function binomialLowerTail(
  successes: number,
  trials: number,
  probability: number
): number {
  if (successes >= trials || probability <= 0) return 1;
  if (probability >= 1) return 0;
  const logP = Math.log(probability);
  const logQ = Math.log1p(-probability);
  const logTerms: number[] = [];
  let logTerm = trials * logQ;
  logTerms.push(logTerm);
  for (let k = 0; k < successes; k++) {
    logTerm += Math.log(trials - k) - Math.log(k + 1) + logP - logQ;
    logTerms.push(logTerm);
  }
  return Math.min(1, Math.exp(logSumExp(logTerms)));
}

export function evaluateRateDrop(
  day: RateCounts,
  baseline: RateCounts,
  minRelativeDrop: number
): RateDropVerdict {
  if (day.denominator < TRIPWIRE_MIN_DAY_DENOMINATOR) {
    return { kind: 'underpowered', window: 'day' };
  }
  if (baseline.denominator < TRIPWIRE_MIN_BASELINE_DENOMINATOR) {
    return { kind: 'underpowered', window: 'baseline' };
  }
  const dayRate = day.numerator / day.denominator;
  const baselineRate = baseline.numerator / baseline.denominator;
  const relativeDrop =
    baselineRate > 0 ? (baselineRate - dayRate) / baselineRate : 0;
  const tailProbability = binomialLowerTail(
    day.numerator,
    day.denominator,
    baselineRate
  );
  const dropped =
    relativeDrop >= minRelativeDrop &&
    tailProbability < TRIPWIRE_MAX_TAIL_PROBABILITY;
  return {
    kind: dropped ? 'dropped' : 'steady',
    dayRate,
    baselineRate,
    relativeDrop,
    tailProbability,
  };
}
