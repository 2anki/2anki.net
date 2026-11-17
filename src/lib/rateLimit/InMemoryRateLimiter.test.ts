import { InMemoryRateLimiter } from './InMemoryRateLimiter';

describe('InMemoryRateLimiter', () => {
  test('allows up to perKeyMax within the window for a single key', () => {
    const limiter = new InMemoryRateLimiter({
      windowMs: 1000,
      perKeyMax: 3,
      globalMax: 100,
      now: () => 0,
    });
    expect(limiter.check('ip-a')).toBe(true);
    expect(limiter.check('ip-a')).toBe(true);
    expect(limiter.check('ip-a')).toBe(true);
    expect(limiter.check('ip-a')).toBe(false);
  });

  test('isolates buckets between distinct keys', () => {
    const limiter = new InMemoryRateLimiter({
      windowMs: 1000,
      perKeyMax: 2,
      globalMax: 100,
      now: () => 0,
    });
    expect(limiter.check('ip-a')).toBe(true);
    expect(limiter.check('ip-a')).toBe(true);
    expect(limiter.check('ip-a')).toBe(false);
    expect(limiter.check('ip-b')).toBe(true);
    expect(limiter.check('ip-b')).toBe(true);
    expect(limiter.check('ip-b')).toBe(false);
  });

  test('resets the per-key bucket once the window elapses', () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter({
      windowMs: 1000,
      perKeyMax: 1,
      globalMax: 100,
      now: () => now,
    });
    expect(limiter.check('ip-a')).toBe(true);
    expect(limiter.check('ip-a')).toBe(false);
    now = 1001;
    expect(limiter.check('ip-a')).toBe(true);
  });

  test('rejects all callers once the global cap is reached', () => {
    const limiter = new InMemoryRateLimiter({
      windowMs: 1000,
      perKeyMax: 10,
      globalMax: 2,
      now: () => 0,
    });
    expect(limiter.check('ip-a')).toBe(true);
    expect(limiter.check('ip-b')).toBe(true);
    expect(limiter.check('ip-c')).toBe(false);
  });

  test('evaluate reports a per-key rejection distinctly from an allow', () => {
    const limiter = new InMemoryRateLimiter({
      windowMs: 1000,
      perKeyMax: 1,
      globalMax: 100,
      now: () => 0,
    });
    expect(limiter.evaluate('ip-a')).toBe('allowed');
    expect(limiter.evaluate('ip-a')).toBe('per_key');
  });

  test('evaluate reports a global rejection distinctly from a per-key one', () => {
    const limiter = new InMemoryRateLimiter({
      windowMs: 1000,
      perKeyMax: 10,
      globalMax: 1,
      now: () => 0,
    });
    expect(limiter.evaluate('ip-a')).toBe('allowed');
    expect(limiter.evaluate('ip-b')).toBe('global');
  });

  test('forgets keys whose window has passed once a window has elapsed', () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter({
      windowMs: 1000,
      perKeyMax: 1,
      globalMax: Number.POSITIVE_INFINITY,
      now: () => now,
    });
    limiter.check('ip-a');
    limiter.check('ip-b');
    limiter.check('ip-c');
    expect(limiter.trackedKeys()).toBe(3);

    now = 1001;
    limiter.check('ip-d');

    expect(limiter.trackedKeys()).toBe(1);
  });

  test('keeps a key whose window is still open through a sweep, with its count', () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter({
      windowMs: 1000,
      perKeyMax: 1,
      globalMax: 100,
      now: () => now,
    });
    limiter.check('ip-a');
    now = 600;
    expect(limiter.check('ip-b')).toBe(true);

    now = 1001;
    limiter.check('ip-c');

    expect(limiter.trackedKeys()).toBe(2);
    expect(limiter.check('ip-b')).toBe(false);
    expect(limiter.check('ip-a')).toBe(true);
  });

  test('does not sweep before a full window has passed', () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter({
      windowMs: 1000,
      perKeyMax: 1,
      globalMax: 100,
      now: () => now,
    });
    limiter.check('ip-a');
    now = 999;
    limiter.check('ip-b');

    expect(limiter.trackedKeys()).toBe(2);
  });

  test('a per-key rejection does not consume the global budget', () => {
    const limiter = new InMemoryRateLimiter({
      windowMs: 1000,
      perKeyMax: 1,
      globalMax: 2,
      now: () => 0,
    });
    expect(limiter.evaluate('ip-a')).toBe('allowed');
    expect(limiter.evaluate('ip-a')).toBe('per_key');
    expect(limiter.evaluate('ip-b')).toBe('allowed');
    expect(limiter.evaluate('ip-c')).toBe('global');
  });
});
