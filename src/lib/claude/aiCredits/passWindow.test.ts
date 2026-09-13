import { pickActivePassWindow } from './passWindow';

describe('pickActivePassWindow', () => {
  it('returns null when there are no active passes', () => {
    expect(pickActivePassWindow([])).toBeNull();
  });

  it('uses the latest-expiring pass to decide the kind', () => {
    const result = pickActivePassWindow([
      { kind: '24h', expiresAt: new Date('2026-05-20T00:00:00.000Z') },
      { kind: '7d', expiresAt: new Date('2026-05-25T00:00:00.000Z') },
    ]);
    expect(result?.kind).toBe('7d');
  });

  it('anchors on the earliest active row of that kind and ends at the latest', () => {
    const result = pickActivePassWindow([
      { kind: '24h', expiresAt: new Date('2026-05-21T00:00:00.000Z') },
      { kind: '24h', expiresAt: new Date('2026-05-20T00:00:00.000Z') },
      { kind: '24h', expiresAt: new Date('2026-05-22T00:00:00.000Z') },
    ]);
    expect(result).toEqual({
      kind: '24h',
      earliestExpiresAt: new Date('2026-05-20T00:00:00.000Z'),
      latestExpiresAt: new Date('2026-05-22T00:00:00.000Z'),
    });
  });

  it('ignores rows of other kinds when computing the window', () => {
    const result = pickActivePassWindow([
      { kind: '7d', expiresAt: new Date('2026-05-30T00:00:00.000Z') },
      { kind: '24h', expiresAt: new Date('2026-05-20T00:00:00.000Z') },
    ]);
    expect(result).toEqual({
      kind: '7d',
      earliestExpiresAt: new Date('2026-05-30T00:00:00.000Z'),
      latestExpiresAt: new Date('2026-05-30T00:00:00.000Z'),
    });
  });
});
