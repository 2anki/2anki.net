import { pickActivePassWindow } from './passWindow';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-05-12T12:00:00.000Z');

describe('pickActivePassWindow', () => {
  it('returns null when there are no active passes', () => {
    expect(pickActivePassWindow([], NOW)).toBeNull();
  });

  it('takes credits/kind from the latest-expiring pass', () => {
    const result = pickActivePassWindow(
      [
        { kind: '24h', expiresAt: new Date('2026-05-13T00:00:00.000Z') },
        { kind: '7d', expiresAt: new Date('2026-05-18T00:00:00.000Z') },
      ],
      NOW
    );
    expect(result?.kind).toBe('7d');
    expect(result?.windowEnd).toEqual(new Date('2026-05-18T00:00:00.000Z'));
  });

  it('anchors the window on the earliest purchase across every active row', () => {
    // A 24h pass bought at NOW, then a 7d pass stacked on top of its expiry.
    const firstExpiry = new Date(NOW.getTime() + DAY);
    const stackedExpiry = new Date(firstExpiry.getTime() + 7 * DAY);
    const result = pickActivePassWindow(
      [
        { kind: '24h', expiresAt: firstExpiry },
        { kind: '7d', expiresAt: stackedExpiry },
      ],
      NOW
    );
    expect(result?.kind).toBe('7d');
    // 24h row anchors at firstExpiry − 24h = NOW, which is earlier than the
    // 7d row's stacked start, so spend from NOW counts.
    expect(result?.windowStart).toEqual(NOW);
    expect(result?.windowEnd).toEqual(stackedExpiry);
  });

  it('clamps the anchor to now when every row would start in the future', () => {
    const result = pickActivePassWindow(
      [{ kind: '24h', expiresAt: new Date(NOW.getTime() + 2 * DAY) }],
      NOW
    );
    // expiresAt − 24h = NOW + 1d (future); clamp to now.
    expect(result?.windowStart).toEqual(NOW);
  });
});
