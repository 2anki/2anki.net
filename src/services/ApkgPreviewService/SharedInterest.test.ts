import { vi } from 'vitest';

import { SharedInterest } from './SharedInterest';

describe('SharedInterest', () => {
  it('aborts once every caller has gone', () => {
    const abandoned = vi.fn();
    const interest = new SharedInterest(abandoned);
    const first = new AbortController();
    const second = new AbortController();
    interest.join(first.signal);
    interest.join(second.signal);

    first.abort();
    expect(interest.signal.aborted).toBe(false);
    second.abort();

    expect(interest.signal.aborted).toBe(true);
    expect(abandoned).toHaveBeenCalledTimes(1);
  });

  it('never aborts while a caller without a signal is waiting', () => {
    const interest = new SharedInterest(vi.fn());
    const gone = new AbortController();
    interest.join(gone.signal);
    interest.join();

    gone.abort();

    expect(interest.signal.aborted).toBe(false);
  });

  it('ignores callers leaving after the work has started', () => {
    const abandoned = vi.fn();
    const interest = new SharedInterest(abandoned);
    const gone = new AbortController();
    interest.join(gone.signal);
    interest.commit();

    gone.abort();

    expect(interest.signal.aborted).toBe(false);
    expect(abandoned).not.toHaveBeenCalled();
  });

  it('aborts at once when the only caller has already gone', () => {
    const interest = new SharedInterest(vi.fn());
    const gone = new AbortController();
    gone.abort();

    interest.join(gone.signal);

    expect(interest.signal.aborted).toBe(true);
  });
});
