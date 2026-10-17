import {
  isRescueCandidate,
  isRescueRule,
  mergeRescueCandidates,
} from './RescueCandidate';

describe('RescueCandidate', () => {
  it('recognises the rule vocabulary and nothing else', () => {
    expect(isRescueRule('heading')).toBe(true);
    expect(isRescueRule('toString')).toBe(false);
    expect(isRescueRule(3)).toBe(false);
  });

  it('accepts only a known rule with a positive integer count', () => {
    expect(isRescueCandidate({ rule: 'bullets', cards: 4 })).toBe(true);
    expect(isRescueCandidate({ rule: 'bullets', cards: 0 })).toBe(false);
    expect(isRescueCandidate({ rule: 'bullets', cards: 1.5 })).toBe(false);
    expect(isRescueCandidate({ rule: 'tables', cards: 2 })).toBe(false);
    expect(isRescueCandidate(null)).toBe(false);
  });

  it('adds counts per rule across sub-decks in the fixed order', () => {
    expect(
      mergeRescueCandidates([
        [
          { rule: 'bullets', cards: 3 },
          { rule: 'heading', cards: 2 },
        ],
        [{ rule: 'bullets', cards: 5 }],
        [],
      ])
    ).toEqual([
      { rule: 'heading', cards: 2 },
      { rule: 'bullets', cards: 8 },
    ]);
  });
});
