import { resolveAllowance, PlanInputs } from './allowance';

const NOW = new Date('2026-05-12T12:00:00.000Z');

const emptyInputs: PlanInputs = {
  passes: [],
  subscription: null,
  patreon: false,
  ankifyAccess: false,
};

describe('resolveAllowance', () => {
  it('returns null for a user with no plan (free / anonymous)', () => {
    expect(resolveAllowance(emptyInputs, NOW)).toBeNull();
  });

  it.each([
    ['24h', 300, new Date('2026-05-13T00:00:00.000Z')],
    ['7d', 500, new Date('2026-05-15T00:00:00.000Z')],
    ['120d', 1500, new Date('2026-08-01T00:00:00.000Z')],
  ] as const)(
    'gives an active %s pass %d credits over its own window',
    (kind, credits, expiresAt) => {
      const result = resolveAllowance(
        { ...emptyInputs, passes: [{ kind, expiresAt }] },
        NOW
      );
      expect(result?.credits).toBe(credits);
      expect(result?.windowEnd).toEqual(expiresAt);
      expect(result?.resets).toBe('pass');
    }
  );

  it('sums two active passes and anchors the window on the earliest start', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        passes: [
          { kind: '7d', expiresAt: new Date('2026-05-14T00:00:00.000Z') },
          { kind: '7d', expiresAt: new Date('2026-05-16T00:00:00.000Z') },
        ],
      },
      NOW
    );
    expect(result).toEqual({
      credits: 1000,
      windowStart: new Date('2026-05-07T00:00:00.000Z'),
      windowEnd: new Date('2026-05-16T00:00:00.000Z'),
      resets: 'pass',
    });
  });

  it('ignores a pass whose window has not started yet', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        passes: [
          { kind: '24h', expiresAt: new Date('2026-05-20T00:00:00.000Z') },
        ],
      },
      NOW
    );
    expect(result).toBeNull();
  });

  it('gives an active monthly subscription 300 credits over its whole period', () => {
    const periodStart = new Date('2026-05-01T00:00:00.000Z');
    const periodEnd = new Date('2026-06-01T00:00:00.000Z');
    const result = resolveAllowance(
      {
        ...emptyInputs,
        subscription: {
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

  it('clamps a day-31 billing anchor to the short month without overflowing', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        subscription: {
          periodStart: new Date('2026-01-31T00:00:00.000Z'),
          periodEnd: new Date('2027-01-31T00:00:00.000Z'),
          unitAmount: 6400,
        },
      },
      new Date('2026-02-15T12:00:00.000Z')
    );
    expect(result?.windowStart).toEqual(new Date('2026-01-31T00:00:00.000Z'));
    expect(result?.windowEnd).toEqual(new Date('2026-02-28T00:00:00.000Z'));
  });

  it('gives a subscriber who also holds a pass the subscription allowance only', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        subscription: {
          periodStart: new Date('2026-05-01T00:00:00.000Z'),
          periodEnd: new Date('2026-06-01T00:00:00.000Z'),
          unitAmount: 799,
        },
        passes: [
          { kind: '24h', expiresAt: new Date('2026-05-13T00:00:00.000Z') },
        ],
      },
      NOW
    );
    expect(result).toEqual({
      credits: 300,
      windowStart: new Date('2026-05-01T00:00:00.000Z'),
      windowEnd: new Date('2026-06-01T00:00:00.000Z'),
      resets: 'period',
    });
  });

  it('does not double-reset a monthly subscription that renews off the 1st', () => {
    const periodStart = new Date('2026-05-08T00:00:00.000Z');
    const periodEnd = new Date('2026-06-08T00:00:00.000Z');
    const result = resolveAllowance(
      {
        ...emptyInputs,
        subscription: { periodStart, periodEnd, unitAmount: 799 },
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

  it('gives an annual subscription 300 credits for the current month, not the year', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        subscription: {
          periodStart: new Date('2026-01-01T00:00:00.000Z'),
          periodEnd: new Date('2027-01-01T00:00:00.000Z'),
          unitAmount: 6400,
        },
      },
      NOW
    );
    expect(result).toEqual({
      credits: 300,
      windowStart: new Date('2026-05-01T00:00:00.000Z'),
      windowEnd: new Date('2026-06-01T00:00:00.000Z'),
      resets: 'period',
    });
  });

  it('gives a legacy $2 / €2 subscription only 100 credits', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        subscription: {
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
    expect(result?.windowEnd).toBeNull();
    expect(result?.resets).toBe('period');
  });

  it('falls back to rolling 30 days when the subscription has no period at all', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        subscription: {
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
    expect(result?.windowEnd).toBeNull();
  });

  it('anchors an Apple unlimited pass on the month, clipped to its expiry', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        passes: [
          {
            kind: 'unlimited',
            expiresAt: new Date('2026-06-01T00:00:00.000Z'),
          },
        ],
      },
      NOW
    );
    expect(result).toEqual({
      credits: 300,
      windowStart: new Date('2026-05-01T00:00:00.000Z'),
      windowEnd: new Date('2026-06-01T00:00:00.000Z'),
      resets: 'period',
    });
  });

  it('clips an Apple unlimited window to a mid-month expiry', () => {
    const result = resolveAllowance(
      {
        ...emptyInputs,
        passes: [
          {
            kind: 'unlimited',
            expiresAt: new Date('2026-05-20T00:00:00.000Z'),
          },
        ],
      },
      NOW
    );
    expect(result?.windowEnd).toEqual(new Date('2026-05-20T00:00:00.000Z'));
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
