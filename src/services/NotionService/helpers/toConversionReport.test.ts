import { toConversionReport } from './toConversionReport';

const storedReport = {
  summary: { blocks_seen: 52, cards_created: 34, blocks_skipped: 3 },
  entries: [
    {
      stage: 'card',
      reason_code: 'empty_back',
      human_reason: 'Cards whose back came out empty',
      count: 3,
    },
  ],
};

describe('toConversionReport', () => {
  it('maps a stored jsonb object to the typed report', () => {
    expect(toConversionReport(storedReport)).toEqual(storedReport);
  });

  it('parses a stored JSON string (text column in the test double)', () => {
    expect(toConversionReport(JSON.stringify(storedReport))).toEqual(
      storedReport
    );
  });

  it('keeps truncation fields when present', () => {
    const truncated = {
      ...storedReport,
      truncated: true,
      omitted_entry_count: 20,
    };
    expect(toConversionReport(truncated)).toEqual(truncated);
  });

  it('drops keys that are not part of the report contract', () => {
    const withExtras = {
      ...storedReport,
      owner: 'user-1',
      entries: [{ ...storedReport.entries[0], internal_note: 'x' }],
    };
    expect(toConversionReport(withExtras)).toEqual(storedReport);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['broken JSON text', '{not json'],
    ['a JSON string of a non-object', '"report"'],
    ['a report missing its summary', { entries: [] }],
    [
      'a summary with a non-numeric count',
      {
        summary: { ...storedReport.summary, blocks_seen: 'many' },
        entries: [],
      },
    ],
    [
      'a report without an entries array',
      { summary: storedReport.summary, entries: 'none' },
    ],
    [
      'an entry with an unknown stage',
      {
        summary: storedReport.summary,
        entries: [{ ...storedReport.entries[0], stage: 'precheck' }],
      },
    ],
    [
      'an entry missing its reason_code',
      {
        summary: storedReport.summary,
        entries: [{ stage: 'card', human_reason: 'x', count: 1 }],
      },
    ],
  ])('returns null for %s', (_label, value) => {
    expect(toConversionReport(value)).toBeNull();
  });
});
