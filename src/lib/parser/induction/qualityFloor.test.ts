import { clearsQualityFloor, FLOOR_MIN_CARDS } from './qualityFloor';
import scoreCandidateDeck, { ScorableCard } from '../scoreCandidateDeck';

function score(cards: ScorableCard[], docChars = 1000) {
  return scoreCandidateDeck(cards, docChars);
}

function goodCard(index: number): ScorableCard {
  return {
    name: `What is concept ${index}?`,
    back: `Concept ${index} is a well-formed answer that a learner would read.`,
  };
}

describe('clearsQualityFloor', () => {
  it('rejects a deck below the minimum card count', () => {
    const cards = Array.from({ length: FLOOR_MIN_CARDS - 1 }, (_, i) =>
      goodCard(i)
    );
    expect(clearsQualityFloor(cards, score(cards))).toBe(false);
  });

  it('accepts a deck of well-formed cards', () => {
    const cards = Array.from({ length: 5 }, (_, i) => goodCard(i));
    expect(clearsQualityFloor(cards, score(cards))).toBe(true);
  });

  it('rejects a deck whose empty-back ratio exceeds the cap', () => {
    const cards: ScorableCard[] = [
      goodCard(0),
      { name: 'Front only A', back: '' },
      { name: 'Front only B', back: '' },
    ];
    expect(clearsQualityFloor(cards, score(cards))).toBe(false);
  });

  it('does not count cloze cards with an empty back against the floor', () => {
    const cards: ScorableCard[] = [
      { name: 'The capital of {{c1::France}} is Paris', back: '', cloze: true },
      { name: 'Water boils at {{c1::100}} degrees', back: '', cloze: true },
      { name: 'The sky is {{c1::blue}}', back: '', cloze: true },
      { name: 'Grass is {{c1::green}}', back: '', cloze: true },
    ];
    expect(clearsQualityFloor(cards, score(cards))).toBe(true);
  });

  it('rejects a deck whose fronts are mostly duplicates', () => {
    const cards: ScorableCard[] = Array.from({ length: 6 }, () => ({
      name: 'Same front',
      back: 'Different backs still fail because the fronts collide.',
    }));
    expect(clearsQualityFloor(cards, score(cards))).toBe(false);
  });

  it('rejects an over-split deck of many one-word fronts', () => {
    const cards: ScorableCard[] = Array.from({ length: 250 }, (_, i) => ({
      name: `term${i}`,
      back: `definition number ${i}`,
    }));
    expect(clearsQualityFloor(cards, score(cards))).toBe(false);
  });
});
