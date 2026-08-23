import {
  buildConversionReport,
  MAX_REPORT_ENTRIES,
} from './buildConversionReport';

const baseInput = {
  blocksSeen: 52,
  cardsCreated: 34,
  emptyBackCount: 0,
  droppedAssetCount: 0,
  forbiddenBlockCount: 0,
};

describe('buildConversionReport', () => {
  it('produces an empty-entries report for a clean conversion', () => {
    const report = buildConversionReport(baseInput);

    expect(report).toEqual({
      summary: { blocks_seen: 52, cards_created: 34, blocks_skipped: 0 },
      entries: [],
    });
  });

  it('aggregates every signal into one accounting', () => {
    const report = buildConversionReport({
      ...baseInput,
      emptyBackCount: 2,
      droppedAssetCount: 1,
      forbiddenBlockCount: 3,
      truncation: { blocksConverted: 40, subDeckRulesSkipped: false },
      unsupportedBlockTypeCounts: new Map([
        ['embed', 4],
        ['synced_block', 1],
      ]),
    });

    expect(report.summary.blocks_skipped).toBe(11);
    expect(report.entries).toEqual([
      expect.objectContaining({
        stage: 'block',
        reason_code: 'blocks_forbidden',
        count: 3,
      }),
      expect.objectContaining({
        stage: 'card',
        reason_code: 'empty_back',
        count: 2,
      }),
      expect.objectContaining({
        stage: 'media',
        reason_code: 'assets_dropped',
        count: 1,
      }),
      expect.objectContaining({
        stage: 'output',
        reason_code: 'truncated',
        count: 1,
      }),
      expect.objectContaining({
        reason_code: 'unsupported_block:embed',
        count: 4,
      }),
      expect.objectContaining({
        reason_code: 'unsupported_block:synced_block',
        count: 1,
      }),
    ]);
    expect(report.truncated).toBeUndefined();
  });

  it('drops zero-count signals instead of writing noise entries', () => {
    const report = buildConversionReport({
      ...baseInput,
      emptyBackCount: 1,
    });

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].reason_code).toBe('empty_back');
  });

  it('caps distinct entries and tallies the overflow', () => {
    const types = new Map<string, number>();
    for (let i = 0; i < MAX_REPORT_ENTRIES + 10; i++) {
      types.set(`custom_${i}`, 2);
    }
    const report = buildConversionReport({
      ...baseInput,
      unsupportedBlockTypeCounts: types,
    });

    expect(report.entries).toHaveLength(MAX_REPORT_ENTRIES);
    expect(report.truncated).toBe(true);
    expect(report.omitted_entry_count).toBe(20);
    expect(report.summary.blocks_skipped).toBe((MAX_REPORT_ENTRIES + 10) * 2);
  });
});
