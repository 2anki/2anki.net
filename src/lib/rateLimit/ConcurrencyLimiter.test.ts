import { ConcurrencyLimiter } from './ConcurrencyLimiter';

describe('ConcurrencyLimiter', () => {
  it('allows up to max concurrent acquisitions and rejects the next', () => {
    const limiter = new ConcurrencyLimiter(2);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    expect(limiter.inFlight).toBe(2);
  });

  it('frees a slot on release so a later caller can acquire', () => {
    const limiter = new ConcurrencyLimiter(1);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    limiter.release();
    expect(limiter.inFlight).toBe(0);
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('never drops below zero on an extra release', () => {
    const limiter = new ConcurrencyLimiter(1);
    limiter.release();
    expect(limiter.inFlight).toBe(0);
  });
});
