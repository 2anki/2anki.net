import {
  LAPSED_RETRY_INTERVAL_MS,
  OFFLINE_LAPSE_MS,
  shouldSkipLapsedOfflinePoll,
} from './offlineBackoff';

const NOW = new Date('2026-08-20T12:00:00Z');

const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60 * 1000);

const lapsedSubscription = () => ({
  last_error: 'Anki client offline — will retry next tick',
  last_synced_at: daysAgo(30),
  last_polled_at: minutesAgo(5),
  created_at: daysAgo(60),
});

describe('shouldSkipLapsedOfflinePoll', () => {
  it('skips a subscription offline past the lapse window and polled recently', () => {
    expect(shouldSkipLapsedOfflinePoll(lapsedSubscription(), NOW)).toBe(true);
  });

  it('polls again once the retry interval has passed', () => {
    const sub = {
      ...lapsedSubscription(),
      last_polled_at: new Date(NOW.getTime() - LAPSED_RETRY_INTERVAL_MS - 1000),
    };
    expect(shouldSkipLapsedOfflinePoll(sub, NOW)).toBe(false);
  });

  it('keeps the normal cadence while the last error is not the offline skip', () => {
    const sub = { ...lapsedSubscription(), last_error: 'Notion fetch failed' };
    expect(shouldSkipLapsedOfflinePoll(sub, NOW)).toBe(false);
  });

  it('keeps the normal cadence when there is no last error', () => {
    const sub = { ...lapsedSubscription(), last_error: null };
    expect(shouldSkipLapsedOfflinePoll(sub, NOW)).toBe(false);
  });

  it('keeps the normal cadence inside the seven-day window', () => {
    const sub = {
      ...lapsedSubscription(),
      last_synced_at: new Date(NOW.getTime() - OFFLINE_LAPSE_MS + 60_000),
    };
    expect(shouldSkipLapsedOfflinePoll(sub, NOW)).toBe(false);
  });

  it('anchors on created_at when the subscription never synced', () => {
    const neverSynced = {
      ...lapsedSubscription(),
      last_synced_at: null,
      created_at: daysAgo(30),
    };
    expect(shouldSkipLapsedOfflinePoll(neverSynced, NOW)).toBe(true);

    const freshNeverSynced = {
      ...neverSynced,
      created_at: daysAgo(2),
    };
    expect(shouldSkipLapsedOfflinePoll(freshNeverSynced, NOW)).toBe(false);
  });

  it('polls when no anchor timestamp exists at all', () => {
    const sub = {
      ...lapsedSubscription(),
      last_synced_at: null,
      created_at: null,
    };
    expect(shouldSkipLapsedOfflinePoll(sub, NOW)).toBe(false);
  });

  it('polls when the subscription was never polled before', () => {
    const sub = { ...lapsedSubscription(), last_polled_at: null };
    expect(shouldSkipLapsedOfflinePoll(sub, NOW)).toBe(false);
  });
});
