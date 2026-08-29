import { getEmptyBackCount } from './getEmptyBackCount';

const report = (entries: Array<{ reason_code: string; count: number }>) => ({
  summary: { blocks_seen: 23, cards_created: 9, blocks_skipped: 14 },
  entries: entries.map((entry) => ({
    stage: 'card',
    human_reason: 'reason',
    ...entry,
  })),
});

describe('getEmptyBackCount', () => {
  it('sums the empty_back entries of a stored report', () => {
    expect(
      getEmptyBackCount(
        report([
          { reason_code: 'empty_back', count: 14 },
          { reason_code: 'unsupported_block', count: 2 },
        ])
      )
    ).toBe(14);
  });

  it('reads a report stored as JSON text', () => {
    expect(
      getEmptyBackCount(
        JSON.stringify(report([{ reason_code: 'empty_back', count: 3 }]))
      )
    ).toBe(3);
  });

  it('is 0 when the report has no empty_back entry', () => {
    expect(
      getEmptyBackCount(report([{ reason_code: 'dropped_asset', count: 4 }]))
    ).toBe(0);
  });

  it('is 0 for a job without a report', () => {
    expect(getEmptyBackCount(null)).toBe(0);
  });

  it('is 0 for a malformed report', () => {
    expect(getEmptyBackCount({ summary: 'nope' })).toBe(0);
    expect(getEmptyBackCount('{not json')).toBe(0);
  });
});
