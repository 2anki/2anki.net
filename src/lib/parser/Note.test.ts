import Note from './Note';

describe('Note', () => {
  test('refresh emoji', () => {
    const note = new Note('🔄This is the back', 'this is the front');
    expect(note.hasRefreshIcon()).toBe(true);
  });
  test('reverse strips the refresh marker from the reversed front', () => {
    const note = new Note('this is the back', '🔄this is the front');
    expect(note.reversed(note).name).toBe('this is the front');
  });
  test('reversed number sorts after source card', () => {
    const note = new Note('this is the back', '🔄this is the front');
    note.number = 4;
    expect(note.reversed(note).number).toBe(4.5);
  });
  test('refresh card yields a marker-free forward note and reversed note', () => {
    const note = new Note('🔄the front', 'the back');
    expect(note.hasRefreshIcon()).toBe(true);

    const reversed = note.reversed(note);
    note.stripRefreshIcon();

    expect(note.name).toBe('the front');
    expect(note.back).toBe('the back');
    expect(reversed.name).toBe('the back');
    expect(reversed.back).toBe('the front');

    for (const face of [note.name, note.back, reversed.name, reversed.back]) {
      expect(face).not.toContain('🔄');
      expect(face).not.toContain('&#x1F504');
    }
  });
  test('a plain front/back note is reversible', () => {
    const note = new Note('the front', 'the back');
    expect(note.isReversibleBasic()).toBe(true);
  });
  test('a cloze note is not reversible', () => {
    const note = new Note('Mitochondria is the {{c1::powerhouse}}', '');
    note.cloze = true;
    expect(note.isReversibleBasic()).toBe(false);
  });
  test('an mcq note is not reversible', () => {
    const note = new Note('Which is a noble gas?', '');
    note.mcq = true;
    note.options = ['Helium', 'Oxygen'];
    note.correctIndices = [0];
    expect(note.isReversibleBasic()).toBe(false);
  });
  test('an input note is not reversible', () => {
    const note = new Note('Capital of France', '');
    note.enableInput = true;
    note.answer = 'Paris';
    expect(note.isReversibleBasic()).toBe(false);
  });
  test('refresh marker in HTML-entity form is stripped from both faces', () => {
    const note = new Note('&#x1F504; the front', 'the back');
    expect(note.hasRefreshIcon()).toBe(true);

    const reversed = note.reversed(note);
    note.stripRefreshIcon();

    expect(note.name).toBe('the front');
    expect(reversed.back).toBe('the front');
    expect(note.name).not.toContain('&#x1F504');
    expect(reversed.back).not.toContain('&#x1F504');
  });
});

describe('Note.isValidBasicNote', () => {
  it.each([
    ['a blank-markup back', 'Question', '<p class="" id="p-1"></p>'],
    ['a blank-markup front', '<p class="" id="p-1"></p>', 'Answer'],
  ])('rejects a card with %s', (_what, front, back) => {
    expect(new Note(front, back).isValidBasicNote()).toBe(false);
  });

  it('accepts an image-only front with a text back', () => {
    expect(new Note('<img src="a.png">', 'Answer').isValidBasicNote()).toBe(
      true
    );
  });
});
