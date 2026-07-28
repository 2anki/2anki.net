import {
  EXPECTED_CHARS_PER_CARD,
  GRANULARITY_MAX_BACK_CHARS,
  scoreCandidateDeck,
} from './scoreCandidateDeck';

function card(name: string, back: string, cloze = false) {
  return { name, back, cloze };
}

function goodDeck(count: number) {
  return Array.from({ length: count }, (_, i) =>
    card(
      `What does term ${i} mean?`,
      `Term ${i} is the process by which a cell converts glucose into usable energy.`
    )
  );
}

describe('scoreCandidateDeck', () => {
  it('returns a zero score and zero signals for an empty deck', () => {
    const result = scoreCandidateDeck([], 5000);
    expect(result).toMatchObject({
      score: 0,
      cardCount: 0,
      docChars: 5000,
      blankBackRate: 0,
      coverage: 0,
    });
  });

  it('scores a well-formed deck above a deck of the same size with blank backs', () => {
    const docChars = 20 * EXPECTED_CHARS_PER_CARD;
    const good = scoreCandidateDeck(goodDeck(20), docChars);
    const blank = scoreCandidateDeck(
      goodDeck(20).map((c) => ({ ...c, back: '' })),
      docChars
    );

    expect(good.score).toBeGreaterThan(blank.score);
    expect(blank.blankBackRate).toBe(1);
    expect(good.blankBackRate).toBe(0);
  });

  it('does not count a cloze card with no back as a blank back', () => {
    const result = scoreCandidateDeck(
      [card('The capital of France is {{c1::Paris}}', '', true)],
      100
    );
    expect(result.blankBackRate).toBe(0);
  });

  it('reports the duplicate-front rate case-insensitively', () => {
    const result = scoreCandidateDeck(
      [
        card('What is ATP?', 'Adenosine triphosphate.'),
        card('what is atp?', 'Adenosine triphosphate.'),
        card('What is DNA?', 'Deoxyribonucleic acid.'),
      ],
      1000
    );
    expect(result.duplicateFrontRate).toBeCloseTo(1 / 3);
  });

  it('measures lengths on the text, not the markup', () => {
    const result = scoreCandidateDeck(
      [card('<p><strong>Q</strong></p>', '<p>Twelve chars</p>')],
      100
    );
    expect(result.medianFrontLen).toBe(1);
    expect(result.medianBackLen).toBe(12);
  });

  it('penalises a deck of a few giant cards through granularity and density', () => {
    const docChars = 30 * EXPECTED_CHARS_PER_CARD;
    const giant = scoreCandidateDeck(
      [
        card('Chapter 1', 'x'.repeat(GRANULARITY_MAX_BACK_CHARS * 3)),
        card('Chapter 2', 'x'.repeat(GRANULARITY_MAX_BACK_CHARS * 3)),
        card('Chapter 3', 'x'.repeat(GRANULARITY_MAX_BACK_CHARS * 3)),
      ],
      docChars
    );

    expect(giant.score).toBeLessThan(
      scoreCandidateDeck(goodDeck(30), docChars).score
    );
    expect(giant.density).toBeLessThan(0.2);
  });

  it('caps coverage at 1 when the cards carry more text than the source', () => {
    const result = scoreCandidateDeck(goodDeck(5), 10);
    expect(result.coverage).toBe(1);
  });

  it('reports zero coverage and density when the source length is unknown', () => {
    const result = scoreCandidateDeck(goodDeck(5), 0);
    expect(result.coverage).toBe(0);
    expect(result.density).toBe(0);
  });

  it('is deterministic for the same input', () => {
    const deck = goodDeck(12);
    expect(scoreCandidateDeck(deck, 4000)).toEqual(
      scoreCandidateDeck(deck, 4000)
    );
  });

  it('keeps the composite inside 0 and 1 for a pathological deck', () => {
    const result = scoreCandidateDeck(
      [card('', ''), card('', ''), card('a', 'x'.repeat(100000))],
      1
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});
