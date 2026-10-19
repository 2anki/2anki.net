import { serializeCardsToMarkdown } from './serializeCardsToMarkdown';
import { guessMarkdownCards } from '../../lib/parser/guessMarkdownCards';

function parseCards(markdown: string) {
  const result = guessMarkdownCards(markdown);
  return { format: result?.formatDetected, notes: result?.notes ?? [] };
}

describe('serializeCardsToMarkdown', () => {
  it('emits one heading-body block per card', () => {
    const markdown = serializeCardsToMarkdown([
      { front: 'What is ATP?', back: 'The energy currency of the cell.' },
      { front: 'What is DNA?', back: 'The molecule of heredity.' },
    ]);
    expect(markdown).toBe(
      '## What is ATP?\n\nThe energy currency of the cell.\n\n' +
        '## What is DNA?\n\nThe molecule of heredity.\n\n'
    );
  });

  it('parses back into the same number of cards via the heading heuristic', () => {
    const cards = [
      { front: 'A', back: 'alpha' },
      { front: 'B', back: 'beta' },
      { front: 'C', back: 'gamma' },
    ];
    const { format, notes } = parseCards(serializeCardsToMarkdown(cards));
    expect(format).toBe('heading-body');
    expect(notes).toHaveLength(3);
  });

  it('flattens a multi-line front into a single heading line', () => {
    const markdown = serializeCardsToMarkdown([
      { front: 'Line one\nLine two\r\nLine three', back: 'answer' },
    ]);
    expect(markdown).toBe('## Line one Line two Line three\n\nanswer\n\n');
    const { notes } = parseCards(markdown);
    expect(notes).toHaveLength(1);
    expect(notes[0].name).toContain('Line one Line two Line three');
  });

  it('renders markdown in the front and back', () => {
    const markdown = serializeCardsToMarkdown([
      { front: 'Bold **term**', back: 'A list:\n\n- one\n- two' },
    ]);
    const { notes } = parseCards(markdown);
    expect(notes).toHaveLength(1);
    expect(notes[0].name).toContain('<strong>term</strong>');
    expect(notes[0].back).toContain('<li>one</li>');
  });

  it('keeps a card body containing :: as one card, not a colon split', () => {
    const { format, notes } = parseCards(
      serializeCardsToMarkdown([
        { front: 'Anki hierarchy', back: 'Parent::Child is a subdeck path.' },
      ])
    );
    expect(format).toBe('heading-body');
    expect(notes).toHaveLength(1);
    expect(notes[0].back).toContain('Parent::Child');
  });

  it('keeps a card body containing Q: as one card, not a QA split', () => {
    const { format, notes } = parseCards(
      serializeCardsToMarkdown([
        { front: 'Study tip', back: 'Q: is a common flashcard prefix.' },
      ])
    );
    expect(format).toBe('heading-body');
    expect(notes).toHaveLength(1);
  });

  it('escapes a <details> toggle so it does not hijack the card format, then renders it (regression: #3739)', () => {
    const markdown = serializeCardsToMarkdown([
      {
        front: 'First card',
        back: '<details><summary>Hint</summary>Secret</details>',
      },
      { front: 'Second card', back: 'Plain answer' },
    ]);
    expect(markdown).not.toMatch(/<details/i);
    const { format, notes } = parseCards(markdown);
    expect(format).toBe('heading-body');
    expect(notes).toHaveLength(2);
    expect(notes[0].back).toContain('<details>');
    expect(notes[0].back).toContain('<summary>Hint</summary>');
  });

  it('renders inline HTML like <br> and <b> in the card back (regression: #3743)', () => {
    const markdown = serializeCardsToMarkdown([
      { front: 'Formatting', back: 'foo<br><b>bar</b>' },
    ]);
    const { notes } = parseCards(markdown);
    expect(notes).toHaveLength(1);
    expect(notes[0].back).toContain('foo<br><b>bar</b>');
    expect(notes[0].back).not.toContain('&lt;br&gt;');
  });

  it('escapes a markdown heading inside the body so it does not split the card', () => {
    const markdown = serializeCardsToMarkdown([
      { front: 'Outline', back: '## Overview\nSome detail' },
      { front: 'Next', back: 'Done' },
    ]);
    const { notes } = parseCards(markdown);
    expect(notes).toHaveLength(2);
  });

  it('escapes a leading heading in the front so it stays a single heading', () => {
    const markdown = serializeCardsToMarkdown([
      { front: '## Already a heading', back: 'answer' },
    ]);
    const { notes } = parseCards(markdown);
    expect(notes).toHaveLength(1);
    expect(markdown.startsWith('## \\## Already a heading')).toBe(true);
  });
});
