import { getCherrySkippedCount } from './getCherrySkippedCount';

const report = (entries: Array<{ reason_code: string; count: number }>) => ({
  summary: { blocks_seen: 23, cards_created: 9, blocks_skipped: 14 },
  entries: entries.map((entry) => ({
    stage: 'card',
    human_reason: 'reason',
    ...entry,
  })),
});

describe('getCherrySkippedCount', () => {
  it('reads the cherry_skipped entry of a stored report', () => {
    expect(
      getCherrySkippedCount(
        report([
          { reason_code: 'empty_back', count: 2 },
          { reason_code: 'cherry_skipped', count: 11 },
        ])
      )
    ).toBe(11);
  });

  it('reads a report stored as JSON text', () => {
    expect(
      getCherrySkippedCount(
        JSON.stringify(report([{ reason_code: 'cherry_skipped', count: 4 }]))
      )
    ).toBe(4);
  });

  it('is 0 without the entry or without a report', () => {
    expect(
      getCherrySkippedCount(report([{ reason_code: 'empty_back', count: 4 }]))
    ).toBe(0);
    expect(getCherrySkippedCount(null)).toBe(0);
  });
});
