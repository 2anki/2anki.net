import { getRescueCandidates } from './getRescueCandidates';

const offer = {
  rule: 'paragraphs',
  cards: 4,
  sample: [{ front: 'Osmosis', back: 'Osmosis moves water.' }],
};

describe('getRescueCandidates', () => {
  it('reads the offer stored on a failed job', () => {
    expect(getRescueCandidates({ rescue_candidates: [offer] })).toEqual([
      offer,
    ]);
  });

  it('reads an offer stored as JSON text', () => {
    expect(
      getRescueCandidates(JSON.stringify({ rescue_candidates: [offer] }))
    ).toEqual([offer]);
  });

  it('drops entries outside the rescue vocabulary', () => {
    expect(
      getRescueCandidates({
        rescue_candidates: [
          offer,
          { rule: 'toString', cards: 3 },
          { rule: 'heading', cards: 0 },
          { rule: 'bullets', cards: '3' },
        ],
      })
    ).toEqual([offer]);
  });

  it.each([
    ['no report', null],
    ['a finished conversion report', { summary: {}, entries: [] }],
    ['unparseable text', '{not json'],
    ['a non-list offer', { rescue_candidates: 'paragraphs' }],
  ])('reads %s as no offer', (_label, stored) => {
    expect(getRescueCandidates(stored)).toEqual([]);
  });
});
