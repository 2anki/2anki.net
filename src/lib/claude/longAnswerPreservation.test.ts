import { expandCompactDeckInfo, mergeDeckInfoArrays } from './ClaudeService';

// A long answer used to be broken into fragments that all reused the original
// front. dedupeCardsByFront, which runs inside mergeDeckInfoArrays, keys on that
// front and keeps only the first — so the user received the opening third of the
// answer and the rest was discarded with no warning. Splitting made the card
// strictly worse than not splitting at all.
describe('long Claude answers survive the parse-to-merge chain', () => {
  const sentence =
    'The citric acid cycle oxidises acetyl-CoA to carbon dioxide and reduces NAD and FAD. ';
  const longAnswer = `<p>${sentence.repeat(22).trim()}</p>`;

  function runChain(compact: {
    deck: string;
    cards: { q: string; a: string }[];
  }) {
    return mergeDeckInfoArrays(expandCompactDeckInfo([compact], [], null));
  }

  function plainLength(html: string): number {
    return html.replace(/<[^>]*>/g, '').length;
  }

  it('keeps a single card for an answer well over the old 600-character ceiling', () => {
    const decks = runChain({
      deck: 'Biochemistry',
      cards: [{ q: 'What is the citric acid cycle?', a: longAnswer }],
    });

    expect(decks[0].cards).toHaveLength(1);
  });

  it('does not discard any of the answer', () => {
    const original = plainLength(longAnswer);
    expect(original).toBeGreaterThan(1800);

    const decks = runChain({
      deck: 'Biochemistry',
      cards: [{ q: 'What is the citric acid cycle?', a: longAnswer }],
    });

    expect(plainLength(decks[0].cards[0].back)).toBe(original);
  });

  it('still collapses genuine duplicates emitted across chunk boundaries', () => {
    const decks = runChain({
      deck: 'Biochemistry',
      cards: [
        { q: 'What is ATP?', a: '<p>Adenosine triphosphate.</p>' },
        { q: 'What is ATP?', a: '<p>Adenosine triphosphate.</p>' },
      ],
    });

    expect(decks[0].cards).toHaveLength(1);
  });
});
