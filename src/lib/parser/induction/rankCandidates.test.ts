import rankCandidates, { Candidate } from './rankCandidates';
import { ScorableCard } from '../scoreCandidateDeck';
import { InducedRule } from './candidateRules';

function wellFormed(count: number): ScorableCard[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `What is process ${i}?`,
    back: `Process ${i} converts inputs into outputs in a documented way.`,
  }));
}

function candidate(
  rule: InducedRule,
  cards: ScorableCard[],
  docChars = 1200
): Candidate<ScorableCard> {
  return { rule, cards, docChars };
}

describe('rankCandidates', () => {
  it('returns no winner when every candidate is below the floor', () => {
    const twoCards = wellFormed(2);
    const result = rankCandidates([candidate('heading', twoCards)]);
    expect(result.winner).toBeNull();
    expect(result.best?.rule).toBe('heading');
  });

  it('lists every candidate with its card count in rule order', () => {
    const result = rankCandidates([
      candidate('bullets', wellFormed(2)),
      candidate('heading', wellFormed(1)),
    ]);
    expect(
      result.candidates.map(({ rule, cards }) => ({ rule, cards }))
    ).toEqual([
      { rule: 'heading', cards: 1 },
      { rule: 'bullets', cards: 2 },
    ]);
  });

  it('samples the first three cards of each candidate as plain text', () => {
    const result = rankCandidates([
      candidate('bullets', [
        { name: '<b>Alpha</b> &amp; omega', back: '<p>One</p>' },
        ...wellFormed(4),
      ]),
    ]);
    expect(result.candidates[0].sample).toHaveLength(3);
    expect(result.candidates[0].sample?.[0]).toEqual({
      front: 'Alpha & omega',
      back: 'One',
    });
  });

  it('ships the best-scoring candidate that clears the floor', () => {
    const strong = wellFormed(6);
    const weak: ScorableCard[] = [
      { name: 'a', back: '' },
      { name: 'b', back: '' },
      { name: 'c', back: '' },
    ];
    const result = rankCandidates([
      candidate('bullets', weak),
      candidate('heading', strong),
    ]);
    expect(result.winner?.rule).toBe('heading');
  });

  it('breaks a score tie by candidate order, most conservative first', () => {
    const cards = wellFormed(5);
    const result = rankCandidates([
      candidate('bullets', cards),
      candidate('heading', cards),
      candidate('columns', cards),
    ]);
    expect(result.winner?.rule).toBe('columns');
  });
});
