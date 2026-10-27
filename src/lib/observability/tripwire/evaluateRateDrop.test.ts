import {
  binomialLowerTail,
  evaluateRateDrop,
  TRIPWIRE_MIN_BASELINE_DENOMINATOR,
  TRIPWIRE_MIN_DAY_DENOMINATOR,
} from './evaluateRateDrop';

describe('binomialLowerTail', () => {
  it('matches the closed form for a total miss', () => {
    expect(binomialLowerTail(0, 4, 0.5)).toBeCloseTo(0.0625, 10);
  });

  it('sums every outcome up to and including the observed count', () => {
    expect(binomialLowerTail(1, 3, 0.5)).toBeCloseTo(0.5, 10);
  });

  it('is 1 when every trial succeeded', () => {
    expect(binomialLowerTail(10, 10, 0.3)).toBe(1);
  });

  it('stays finite for large trial counts that underflow a naive product', () => {
    const tail = binomialLowerTail(900, 1000, 0.9);
    expect(tail).toBeGreaterThan(0.4);
    expect(tail).toBeLessThan(0.6);
  });
});

describe('evaluateRateDrop', () => {
  it('trips when a well-sampled rate collapses against its baseline', () => {
    const verdict = evaluateRateDrop(
      { numerator: 0, denominator: 12 },
      { numerator: 60, denominator: 80 },
      0.4
    );

    expect(verdict.kind).toBe('dropped');
  });

  it('trips on a moderate drop when volume is high enough to show it', () => {
    const verdict = evaluateRateDrop(
      { numerator: 330, denominator: 500 },
      { numerator: 3150, denominator: 3500 },
      0.15
    );

    expect(verdict).toMatchObject({ kind: 'dropped' });
  });

  it('stays quiet when the same collapse arrives on too few rows to show it', () => {
    const verdict = evaluateRateDrop(
      { numerator: 0, denominator: TRIPWIRE_MIN_DAY_DENOMINATOR - 1 },
      { numerator: 60, denominator: 80 },
      0.4
    );

    expect(verdict).toEqual({ kind: 'underpowered', window: 'day' });
  });

  it('stays quiet when the baseline is too thin to trust', () => {
    const verdict = evaluateRateDrop(
      { numerator: 0, denominator: 40 },
      { numerator: 20, denominator: TRIPWIRE_MIN_BASELINE_DENOMINATOR - 1 },
      0.4
    );

    expect(verdict).toEqual({ kind: 'underpowered', window: 'baseline' });
  });

  it('stays quiet on a drop smaller than the metric threshold', () => {
    const verdict = evaluateRateDrop(
      { numerator: 410, denominator: 500 },
      { numerator: 3150, denominator: 3500 },
      0.15
    );

    expect(verdict.kind).toBe('steady');
  });

  it('stays quiet on a large relative drop that chance explains', () => {
    const verdict = evaluateRateDrop(
      { numerator: 2, denominator: 6 },
      { numerator: 40, denominator: 80 },
      0.3
    );

    expect(verdict.kind).toBe('steady');
  });

  it('never trips on a rate that went up', () => {
    const verdict = evaluateRateDrop(
      { numerator: 75, denominator: 100 },
      { numerator: 250, denominator: 500 },
      0.15
    );

    expect(verdict).toMatchObject({ kind: 'steady', relativeDrop: -0.5 });
  });

  it('reports the rates it compared', () => {
    const verdict = evaluateRateDrop(
      { numerator: 25, denominator: 100 },
      { numerator: 400, denominator: 500 },
      0.3
    );

    expect(verdict).toMatchObject({
      kind: 'dropped',
      dayRate: 0.25,
      baselineRate: 0.8,
    });
  });
});
