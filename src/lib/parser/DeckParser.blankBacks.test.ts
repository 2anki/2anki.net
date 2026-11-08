import { vi } from 'vitest';

import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

// The real exporter shells out to the Python venv; these tests only need the
// payload build hands it.
vi.mock('./exporters/CustomExporter', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return {
      configure: vi.fn(),
      save: vi.fn().mockResolvedValue(Buffer.from('fake-apkg')),
    };
  }),
}));

beforeEach(() => setupTests());

async function builtParser(html: string, cardLimit?: number) {
  const parser = new DeckParser({
    name: 'notes.html',
    settings: new CardOption({}),
    files: [{ name: 'notes.html', contents: Buffer.from(html) }],
    noLimits: cardLimit == null,
    workspace: new Workspace(true, 'fs'),
    cardLimit,
  });
  await parser.build(new Workspace(true, 'fs'));
  return parser;
}

const page = (body: string) => `<html><body>${body}</body></html>`;
const paragraphs = (lines: string[]) =>
  lines.map((line) => `<p>${line}</p>`).join('');
const toggle = (question: string, answer: string) =>
  `<ul class="toggle"><li><details open=""><summary>${question}</summary><p>${answer}</p></details></li></ul>`;

describe('DeckParser cards that ship with no answer', () => {
  it('counts every card of a paragraph-only file, each one a line with a blank back', async () => {
    const parser = await builtParser(
      page(
        paragraphs([
          'The cell is the basic unit of life',
          'Mitochondria make energy for the cell',
          'Ribosomes build proteins',
          'The nucleus holds the DNA',
          'Chloroplasts capture light in plants',
          'The membrane controls what enters the cell',
        ])
      )
    );

    expect(parser.totalCardCount()).toBe(6);
    expect(parser.blankBackCount).toBe(6);
  });

  it('leaves the skipped-card count alone, since these cards are in the deck', async () => {
    const parser = await builtParser(
      page(paragraphs(['Only a line', 'Another line']))
    );

    expect(parser.emptyBackCount).toBe(0);
    expect(parser.blankBackCount).toBe(2);
  });

  it('counts a cloze line without a deletion as having no answer once half the deck is blank', async () => {
    const parser = await builtParser(
      page(paragraphs(['The {{c1::cell}} is the unit of life', 'Plain line']))
    );

    expect(parser.blankBackCount).toBe(1);
  });

  it('stays quiet when fewer than half the cards have no answer', async () => {
    const parser = await builtParser(
      page(
        paragraphs([
          'The {{c1::cell}} is the unit of life',
          'The {{c1::nucleus}} holds the DNA',
          'The {{c1::ribosome}} builds proteins',
          'Plain line',
          'Another plain line',
        ])
      )
    );

    expect(parser.blankBackCount).toBe(0);
  });

  it('judges the delivered deck, not the file, when the card limit cuts it', async () => {
    const parser = await builtParser(
      page(
        paragraphs([
          'The {{c1::cell}} is the unit of life',
          'The {{c1::nucleus}} holds the DNA',
          'Plain line one',
          'Plain line two',
          'Plain line three',
          'Plain line four',
        ])
      ),
      3
    );

    expect(parser.totalCardCount()).toBe(3);
    expect(parser.blankBackCount).toBe(0);
  });

  it('counts the blank cards of a one-column CSV on the plain-text fallback', async () => {
    const parser = new DeckParser({
      name: 'terms.csv',
      settings: new CardOption({}),
      files: [
        {
          name: 'terms.csv',
          contents: Buffer.from('Mitosis\nMeiosis\nOsmosis\n'),
        },
      ],
      noLimits: true,
      workspace: new Workspace(true, 'fs'),
    });
    await parser.tryExperimental();

    expect(parser.totalCardCount()).toBeGreaterThan(0);
    expect(parser.blankBackCount).toBe(parser.totalCardCount());
  });

  it('reports the answerless lines the card limit cut as left out, not held back', async () => {
    const parser = await builtParser(
      page(
        paragraphs([
          'The {{c1::cell}} is the unit of life',
          'The {{c1::nucleus}} holds the DNA',
          'Plain line one',
          'The {{c1::ribosome}} builds proteins',
          'Plain line two',
          'Plain line three',
        ])
      ),
      2
    );

    expect(parser.totalCardCount()).toBe(2);
    expect(parser.cardsHeldBack).toBe(1);
    expect(parser.cardsLeftOut).toBe(3);
  });

  it('stays quiet for toggles that all have answers', async () => {
    const parser = await builtParser(
      page(toggle('Q1', 'A1') + toggle('Q2', 'A2'))
    );

    expect(parser.blankBackCount).toBe(0);
  });
});
