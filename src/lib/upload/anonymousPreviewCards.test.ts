import { createHash } from 'node:crypto';

import {
  ANONYMOUS_PREVIEW_CARDS_FLAG,
  resolvePreviewCardsArm,
} from './anonymousPreviewCards';

function septemberPartialArm(anonId: string): 'control' | 'treatment' {
  const digest = createHash('sha256').update(anonId).digest();
  return digest[0] % 2 === 0 ? 'treatment' : 'control';
}

describe('resolvePreviewCardsArm', () => {
  it('reads the anonymous_preview_cards flag', () => {
    expect(ANONYMOUS_PREVIEW_CARDS_FLAG).toBe('anonymous_preview_cards');
  });

  it('puts every visitor in the off arm while the flag is off', () => {
    expect(resolvePreviewCardsArm('golden-anon', false)).toBe('off');
  });

  it('puts a visitor with no anon id in the off arm, since no copy could be keyed to them', () => {
    expect(resolvePreviewCardsArm(null, true)).toBe('off');
    expect(resolvePreviewCardsArm('', true)).toBe('off');
  });

  it('keeps a visitor in the same arm on every upload', () => {
    const first = resolvePreviewCardsArm('anon-stable', true);
    for (let i = 0; i < 5; i++) {
      expect(resolvePreviewCardsArm('anon-stable', true)).toBe(first);
    }
  });

  it('picks the arm from the salted sha256 of the anon id', () => {
    for (let i = 0; i < 50; i++) {
      const anonId = `anon-${i}`;
      const digest = createHash('sha256')
        .update(`preview-cards:${anonId}`)
        .digest();
      expect(resolvePreviewCardsArm(anonId, true)).toBe(
        digest[0] % 2 === 0 ? 'treatment' : 'control'
      );
    }
  });

  it('splits visitors close to half and half', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `visitor-${i}`);
    const treatment = ids.filter(
      (id) => resolvePreviewCardsArm(id, true) === 'treatment'
    ).length;
    expect(treatment).toBeGreaterThan(900);
    expect(treatment).toBeLessThan(1100);
  });

  it('does not line up with the September partial-delivery split', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `visitor-${i}`);
    const agree = ids.filter(
      (id) => resolvePreviewCardsArm(id, true) === septemberPartialArm(id)
    ).length;
    expect(agree).toBeGreaterThan(900);
    expect(agree).toBeLessThan(1100);
  });
});
