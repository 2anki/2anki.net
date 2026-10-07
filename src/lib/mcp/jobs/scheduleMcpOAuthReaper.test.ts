import { vi } from 'vitest';
import {
  MCP_OAUTH_REAP_INTERVAL_MS,
  MCP_ORPHAN_CLIENT_MAX_AGE_MS,
  reapMcpOAuth,
  scheduleMcpOAuthReaper,
} from './scheduleMcpOAuthReaper';

const buildRepos = () => ({
  authorizationCodes: { deleteExpired: vi.fn().mockResolvedValue(2) },
  tokens: {
    deleteExpiredAccessTokens: vi.fn().mockResolvedValue(24),
    deleteExpiredRefreshTokens: vi.fn().mockResolvedValue(3),
  },
  clients: { deleteOrphaned: vi.fn().mockResolvedValue(1) },
});

describe('reapMcpOAuth', () => {
  it('reaps every table and reports per-table counts', async () => {
    const repos = buildRepos();
    const now = new Date('2026-07-20T12:00:00.000Z');

    const result = await reapMcpOAuth(repos, now);

    expect(result).toEqual({
      authorizationCodes: 2,
      accessTokens: 24,
      refreshTokens: 3,
      orphanedClients: 1,
    });
    expect(repos.authorizationCodes.deleteExpired).toHaveBeenCalledWith(now);
    expect(repos.tokens.deleteExpiredAccessTokens).toHaveBeenCalledWith(now);
    expect(repos.tokens.deleteExpiredRefreshTokens).toHaveBeenCalledWith(now);
  });

  it('reaps tokens before orphaned clients so drained clients qualify', async () => {
    const repos = buildRepos();
    const order: string[] = [];
    repos.tokens.deleteExpiredAccessTokens.mockImplementation(async () => {
      order.push('access');
      return 0;
    });
    repos.tokens.deleteExpiredRefreshTokens.mockImplementation(async () => {
      order.push('refresh');
      return 0;
    });
    repos.authorizationCodes.deleteExpired.mockImplementation(async () => {
      order.push('codes');
      return 0;
    });
    repos.clients.deleteOrphaned.mockImplementation(async () => {
      order.push('clients');
      return 0;
    });

    await reapMcpOAuth(repos, new Date('2026-07-20T12:00:00.000Z'));

    expect(order.indexOf('clients')).toBe(order.length - 1);
  });

  it('derives the orphan-client cutoff from the max age in seconds', async () => {
    const repos = buildRepos();
    const now = new Date('2026-07-20T12:00:00.000Z');

    await reapMcpOAuth(repos, now);

    const expectedCutoffSeconds = Math.floor(
      (now.getTime() - MCP_ORPHAN_CLIENT_MAX_AGE_MS) / 1000
    );
    expect(repos.clients.deleteOrphaned).toHaveBeenCalledWith(
      expectedCutoffSeconds
    );
  });
});

describe('scheduleMcpOAuthReaper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('runs a sweep on each interval tick', async () => {
    const repos = buildRepos();

    const handle = scheduleMcpOAuthReaper(repos, { intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);

    expect(repos.authorizationCodes.deleteExpired).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });

  it('defaults to an hourly cadence', () => {
    expect(MCP_OAUTH_REAP_INTERVAL_MS).toBe(60 * 60 * 1000);
  });

  it('swallows a sweep failure without throwing', async () => {
    const repos = buildRepos();
    repos.tokens.deleteExpiredAccessTokens.mockRejectedValue(
      new Error('db down')
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handle = scheduleMcpOAuthReaper(repos, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    clearInterval(handle);
  });
});
