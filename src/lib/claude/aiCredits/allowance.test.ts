import { resolveAllowance, PlanInputs } from './allowance';

const NOW = new Date('2026-05-12T12:00:00.000Z');

const emptyInputs: PlanInputs = {
  pass: null,
  subscription: null,
  patreon: false,
  ankifyAccess: false,
};

describe('resolveAllowance', () => {
  it('returns null for a user with no plan (free / anonymous)', () => {
    expect(resolveAllowance(emptyInputs, NOW)).toBeNull();
  });

  it.each([
    ['24h', 300, 24 * 60 * 60 * 1000],
    ['7d', 500, 7 * 24 * 60 * 60 * 1000],
    ['120d', 1500, 120 * 24 * 60 * 60 * 1000],
  ] as const)(
    'gives a %s pass %d credits over its own duration ending at expiry',
    (kind, credits, durationMs) => {
      const expiresAt = new Date('2026-05-20T00:00:00.000Z');
      const result = resolveAllowance(
        { ...emptyInputs, pass: { kind, expiresAt } },
        NOW
      );
      expect(result).toEqual({
        credits,
        windowStart: new Date(expiresAt.getTime() - durationMs),
        windowEnd: expiresAt,
        resets: 'pass',
      });
    }
  );

  it('gives an active subscription 300 credits over its item-level period', () => {
    const periodStart = new Date('2026-05-01T00:00:00.000Z');
    const periodEnd = new Date('2026-06-01T00:00:00.000Z');
    const result = resolveAllowance(
      {
        ...emptyInputs,
        subscription: {
          active: true,
          periodStart,
          periodEnd,
          unitAmount: 799,
        },
      },
      NOW
    );
    expect(result).toEqual({
      credits: 300,
      windowStart: periodStart,
      windowEnd: periodEnd,
      resets: 'period',
    });
  });

  it('gives a legacy $2 / €2 subscription only 100 credits', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        subscription: {
          active: true,
          periodStart: new Date('2026-05-01T00:00:00.000Z'),
          periodEnd: new Date('2026-06-01T00:00:00.000Z'),
          unitAmount: 200,
        },
      },
      NOW
    );
    expect(result?.credits).toBe(100);
  });

  it('falls back to a rolling 30-day window when the subscription period is stale', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        subscription: {
          active: true,
          periodStart: new Date('2026-01-01T00:00:00.000Z'),
          periodEnd: new Date('2026-02-01T00:00:00.000Z'),
          unitAmount: 799,
        },
      },
      NOW
    );
    const rollingMs = 30 * 24 * 60 * 60 * 1000;
    expect(result?.credits).toBe(300);
    expect(result?.windowStart).toEqual(new Date(NOW.getTime() - rollingMs));
    expect(result?.resets).toBe('period');
  });

  it('falls back to rolling 30 days when the subscription has no period at all', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        subscription: {
          active: true,
          periodStart: null,
          periodEnd: null,
          unitAmount: null,
        },
      },
      NOW
    );
    const rollingMs = 30 * 24 * 60 * 60 * 1000;
    expect(result?.credits).toBe(300);
    expect(result?.windowStart).toEqual(new Date(NOW.getTime() - rollingMs));
  });

  it('gives an Apple unlimited pass the Unlimited allowance over a rolling window', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        pass: {
          kind: 'unlimited',
          expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      },
      NOW
    );
    expect(result?.credits).toBe(300);
    expect(result?.resets).toBe('period');
  });

  it('gives a lifetime (patreon) user 300 credits over the calendar month', () => {
    const result = resolveAllowance({ ...emptyInputs, patreon: true }, NOW);
    expect(result).toEqual({
      credits: 300,
      windowStart: new Date('2026-05-01T00:00:00.000Z'),
      windowEnd: new Date('2026-06-01T00:00:00.000Z'),
      resets: 'month',
    });
  });

  it('gives an ankify_access comp user 300 credits over the calendar month', () => {
    const result = resolveAllowance(
      { ...emptyInputs, ankifyAccess: true },
      NOW
    );
    expect(result?.credits).toBe(300);
    expect(result?.resets).toBe('month');
  });

  it('prefers an active subscription over lifetime when a user holds both', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        patreon: true,
        subscription: {
          active: true,
          periodStart: new Date('2026-05-01T00:00:00.000Z'),
          periodEnd: new Date('2026-06-01T00:00:00.000Z'),
          unitAmount: 200,
        },
      },
      NOW
    );
    expect(result?.credits).toBe(100);
    expect(result?.resets).toBe('period');
  });
});
