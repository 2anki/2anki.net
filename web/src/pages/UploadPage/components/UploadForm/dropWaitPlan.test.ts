import { describe, expect, it } from 'vitest';

import { dropWaitDelays } from './dropWaitPlan';

const total = (delays: number[]) => delays.reduce((sum, d) => sum + d, 0);

describe('dropWaitDelays', () => {
  it('waits about a minute when the upload died within seconds', () => {
    const delays = dropWaitDelays(1_000);
    expect(total(delays)).toBe(60_000);
    expect(new Set(delays)).toEqual(new Set([4_000]));
  });

  it('waits six minutes for an upload that ran a while, checking less often after the first minute', () => {
    const delays = dropWaitDelays(40_000);
    expect(total(delays)).toBeGreaterThanOrEqual(6 * 60_000);
    expect(total(delays)).toBeLessThan(6 * 60_000 + 10_000);
    expect(delays.slice(0, 15).every((d) => d === 4_000)).toBe(true);
    expect(delays.slice(15).every((d) => d === 10_000)).toBe(true);
  });
});
