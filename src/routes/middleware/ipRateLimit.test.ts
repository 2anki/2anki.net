import { vi } from 'vitest';
import { ipRateLimit } from './ipRateLimit';

vi.mock('../../lib/rateLimit/ipHelpers', () => ({
  resolveClientIp: (req: { ip: string }) => req.ip,
}));

function run(limit: ReturnType<typeof ipRateLimit>, ip: string) {
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnValue({ json }) };
  const next = vi.fn();
  limit({ ip } as never, res as never, next);
  return { next, status: res.status };
}

describe('ipRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets the first N requests per minute through and 429s the rest', () => {
    const limit = ipRateLimit(2);
    expect(run(limit, '1.1.1.1').next).toHaveBeenCalled();
    expect(run(limit, '1.1.1.1').next).toHaveBeenCalled();
    const third = run(limit, '1.1.1.1');
    expect(third.next).not.toHaveBeenCalled();
    expect(third.status).toHaveBeenCalledWith(429);
  });

  it('keeps a separate budget per ip', () => {
    const limit = ipRateLimit(1);
    run(limit, '1.1.1.1');
    expect(run(limit, '2.2.2.2').next).toHaveBeenCalled();
  });

  it('resets after a minute', () => {
    const limit = ipRateLimit(1);
    run(limit, '1.1.1.1');
    vi.advanceTimersByTime(60 * 1000);
    expect(run(limit, '1.1.1.1').next).toHaveBeenCalled();
  });

  it('sweeps expired windows once many ips were seen, so the map stays bounded', () => {
    const limit = ipRateLimit(1, 3);
    run(limit, '1.1.1.1');
    run(limit, '2.2.2.2');
    run(limit, '3.3.3.3');
    vi.advanceTimersByTime(60 * 1000);
    run(limit, '4.4.4.4');
    expect(run(limit, '1.1.1.1').next).toHaveBeenCalled();
  });

  it('evicts the oldest ip when the cap is hit inside one window', () => {
    const limit = ipRateLimit(1, 2);
    run(limit, '1.1.1.1');
    run(limit, '2.2.2.2');
    run(limit, '3.3.3.3');
    expect(run(limit, '1.1.1.1').next).toHaveBeenCalled();
    expect(run(limit, '1.1.1.1').next).not.toHaveBeenCalled();
  });
});
