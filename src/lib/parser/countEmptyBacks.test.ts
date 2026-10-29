import { countEmptyBacks } from './countEmptyBacks';
import Note from './Note';

interface Card {
  front: string;
  back: string;
}

const getBack = (c: Card) => c.back;
const getFront = (c: Card) => c.front;

describe('countEmptyBacks', () => {
  it('counts a card whose back is an empty string and front is non-empty', () => {
    const cards: Card[] = [
      { front: 'What is the capital of France?', back: '' },
    ];
    expect(countEmptyBacks(cards, getBack, getFront)).toBe(1);
  });

  it('counts a card whose back is only whitespace', () => {
    const cards: Card[] = [{ front: 'Question', back: '   \n\t ' }];
    expect(countEmptyBacks(cards, getBack, getFront)).toBe(1);
  });

  it('excludes a card whose front is also empty (a different discard)', () => {
    const cards: Card[] = [{ front: '', back: '' }];
    expect(countEmptyBacks(cards, getBack, getFront)).toBe(0);
  });

  it('excludes a fully populated card', () => {
    const cards: Card[] = [{ front: 'Question', back: 'Answer' }];
    expect(countEmptyBacks(cards, getBack, getFront)).toBe(0);
  });

  it('counts only the empty-back cards in a mixed set', () => {
    const cards: Card[] = [
      { front: 'a', back: 'A' },
      { front: 'b', back: '' },
      { front: '', back: '' },
      { front: 'd', back: '   ' },
    ];
    expect(countEmptyBacks(cards, getBack, getFront)).toBe(2);
  });

  it('counts a back that is only empty markup', () => {
    const cards: Card[] = [{ front: 'Question', back: '<p class=""></p>' }];
    expect(countEmptyBacks(cards, getBack, getFront)).toBe(1);
  });

  it('excludes a card whose front is only empty markup', () => {
    const cards: Card[] = [{ front: '<p></p>', back: '<p></p>' }];
    expect(countEmptyBacks(cards, getBack, getFront)).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(countEmptyBacks([], getBack, getFront)).toBe(0);
  });

  it('treats a null/undefined back as empty', () => {
    const cards = [{ front: 'q', back: null }];
    expect(
      countEmptyBacks(
        cards,
        (c) => c.back,
        (c) => c.front
      )
    ).toBe(1);
  });

  it('skips cards the isCountable predicate rejects', () => {
    const cards: Card[] = [
      { front: 'kept', back: '' },
      { front: 'skipped', back: '' },
    ];

    const count = countEmptyBacks(
      cards,
      getBack,
      getFront,
      (c) => c.front !== 'skipped'
    );

    expect(count).toBe(1);
  });
});

// The metric must count only cards Deck.CleanCards will actually drop. A valid
// cloze/mcq/input note carries an empty back by design (answer in the cloze
// markup / options / answer field) and is kept — counting it inflated the
// empty-back "loss" rate with non-loss cards. This mirrors the predicate both
// production call sites pass.
describe('countEmptyBacks — excludes valid non-basic note types', () => {
  const isGenuineLoss = (note: Note) =>
    !note.isValidMCQNote() &&
    !note.isValidClozeNote() &&
    !note.isValidInputNote();

  function basicEmptyBack(): Note {
    return new Note('What is the capital of France?', '');
  }

  function clozeEmptyBack(): Note {
    const note = new Note('{{c1::Paris}} is the capital of France', '');
    note.cloze = true;
    return note;
  }

  function mcqEmptyBack(): Note {
    const note = new Note('Pick the capital of France', '');
    note.mcq = true;
    note.options = ['Paris', 'Lyon'];
    note.correctIndices = [0];
    return note;
  }

  function inputEmptyBack(): Note {
    const note = new Note('Capital of France?', '');
    note.enableInput = true;
    note.answer = 'Paris';
    return note;
  }

  it('counts a basic card with an empty back as genuine loss', () => {
    const count = countEmptyBacks(
      [basicEmptyBack()],
      (n) => n.back,
      (n) => n.name,
      isGenuineLoss
    );

    expect(count).toBe(1);
  });

  it('does not count valid cloze, mcq, or input notes with empty backs', () => {
    const notes = [clozeEmptyBack(), mcqEmptyBack(), inputEmptyBack()];

    const count = countEmptyBacks(
      notes,
      (n) => n.back,
      (n) => n.name,
      isGenuineLoss
    );

    expect(count).toBe(0);
  });

  it('counts only the genuinely-lost basic card in a mixed deck', () => {
    const notes = [
      basicEmptyBack(),
      clozeEmptyBack(),
      mcqEmptyBack(),
      inputEmptyBack(),
    ];

    const count = countEmptyBacks(
      notes,
      (n) => n.back,
      (n) => n.name,
      isGenuineLoss
    );

    expect(count).toBe(1);
  });
});
