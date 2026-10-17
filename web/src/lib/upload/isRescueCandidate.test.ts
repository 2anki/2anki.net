import { readRescueCandidates } from './isRescueCandidate';

describe('readRescueCandidates', () => {
  it('keeps well-formed candidates and drops the rest', () => {
    expect(
      readRescueCandidates([
        { rule: 'heading', cards: 14 },
        { rule: 'tables', cards: 2 },
        { rule: 'bullets', cards: 0 },
        { rule: 'quote', cards: 2.5 },
        null,
        { rule: 'guess', cards: 3 },
      ])
    ).toEqual([
      { rule: 'heading', cards: 14 },
      { rule: 'guess', cards: 3 },
    ]);
  });

  it('returns nothing for a non-array', () => {
    expect(readRescueCandidates({ rule: 'heading', cards: 1 })).toEqual([]);
    expect(readRescueCandidates(undefined)).toEqual([]);
  });
});
