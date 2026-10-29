import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import * as XLSX from 'xlsx';
import Workspace from './WorkSpace';
import { convertXLSXToHTML } from '../../infrastracture/adapters/fileConversion/convertXLSXToHTML';
import { serializeCardsToMarkdown } from '../../services/mcp/serializeCardsToMarkdown';
import { mcpOptionsToCardSettings } from '../../services/mcp/mcpOptionsToCardSettings';

beforeEach(() => setupTests());

const toggle = (id: string, summary: string, body: string) =>
  `<ul id="${id}" class="toggle"><li><details open=""><summary>${summary}</summary>${body}</details></li></ul>`;

const exportPage = (toggles: string) =>
  `<html><head><title>Notes</title></head><body><article class="page sans"><div class="page-body">${toggles}</div></article></body></html>`;

// Cloze off by default here: the basic-card path. The cloze-on cases are
// further down.
const parse = async (
  contents: string,
  settings = new CardOption({ cloze: 'false' })
) => {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'notes.html',
    settings,
    files: [{ name: 'notes.html', contents }],
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);
  return parser;
};

const stripTags = (html: string) => html.replace(/<[^>]*>/g, '').trim();

const page = exportPage(
  toggle('a', 'Has an answer', '<p id="p1" class="">Answer one</p>') +
    toggle('b', 'Only an empty line inside', '<p id="p2" class=""></p>') +
    toggle('c', 'Only line breaks inside', '<p id="p3" class=""><br/></p>') +
    toggle('d', 'Only a picture inside', '<figure><img src="x.png"/></figure>')
);

describe('a toggle whose answer is only empty markup in an uploaded export, cloze off', () => {
  it('leaves it out of the deck and keeps an image-only answer', async () => {
    const parser = await parse(page);

    const fronts = parser.payload.flatMap((deck) =>
      deck.cards.map((card) => stripTags(card.name))
    );
    expect(fronts).toEqual(['Has an answer', 'Only a picture inside']);
  });

  it('counts it as an empty back', async () => {
    const parser = await parse(page);

    expect(parser.emptyBackCount).toBe(2);
  });

  it('drops it when the deck is reversed and the blank answer would be the front', async () => {
    const parser = await parse(
      page,
      new CardOption({ cloze: 'false', reversed: 'true' })
    );

    const questions = parser.payload.flatMap((deck) =>
      deck.cards.map((card) => stripTags(card.back))
    );
    expect(questions).toEqual(['Has an answer', 'Only a picture inside']);
  });
});

describe('a page where every toggle answer is empty markup', () => {
  const allBlank = exportPage(
    toggle(
      '2a0e2c3a-0000-4000-8000-000000000002',
      'Only an empty line inside',
      '<p id="p2" class=""></p>'
    ) +
      toggle(
        '2a0e2c3a-0000-4000-8000-000000000003',
        'Another empty one',
        '<p id="p3" class=""><br/></p>'
      )
  );

  it('makes no cards with cloze off', async () => {
    const parser = await parse(allBlank);

    expect(parser.totalCardCount()).toBe(0);
    expect(parser.emptyDeckReason()).toBe('unknown');
  });

  it('makes no cards with cloze on either, rather than front-only cards', async () => {
    const parser = await parse(allBlank, new CardOption({}));

    expect(parser.totalCardCount()).toBe(0);
    expect(parser.emptyDeckReason()).toBe('unknown');
  });
});

// create_deck with note_type basic turns cloze off; with no note type cloze
// stays on and these cards ship front-only as before.
describe('cards an MCP create_deck call writes as markdown, note type basic', () => {
  it('drops a card whose back is only a non-breaking space', async () => {
    const workspace = new Workspace(true, 'fs');
    const contents = serializeCardsToMarkdown([
      { front: 'Kept question', back: 'Answer' },
      { front: 'Blank answer', back: '&nbsp;' },
    ]);
    const parser = new DeckParser({
      name: 'deck.md',
      settings: new CardOption(mcpOptionsToCardSettings({ noteType: 'basic' })),
      files: [{ name: 'deck.md', contents }],
      noLimits: true,
      workspace,
    });
    await parser.writeDeckInfo(workspace);

    const fronts = parser.payload.flatMap((deck) =>
      deck.cards.map((card) => stripTags(card.name))
    );
    expect(fronts).toEqual(['Kept question']);
  });
});

describe('toggles with no answer in a cloze-on upload', () => {
  const ids = [
    '1f0e2c3a-0000-4000-8000-000000000001',
    '1f0e2c3a-0000-4000-8000-000000000002',
    '1f0e2c3a-0000-4000-8000-000000000003',
  ];
  const clozeToggle = (summary: string) =>
    toggle(ids[0], summary, '<p class=""></p>');
  const clozeOn = () => new CardOption({ cloze: 'true' });

  const mixedPage = exportPage(
    toggle(ids[0], 'Has an answer', '<p class="">Answer one</p>') +
      toggle(ids[1], 'Nothing inside', '') +
      toggle(ids[2], 'Only an empty line inside', '<p class=""></p>')
  );

  it('drops a toggle with nothing inside and one with only an empty line', async () => {
    const parser = await parse(mixedPage, clozeOn());

    const fronts = parser.payload.flatMap((deck) =>
      deck.cards.map((card) => stripTags(card.name))
    );
    expect(fronts).toEqual(['Has an answer']);
  });

  it('counts both as empty backs', async () => {
    const parser = await parse(mixedPage, clozeOn());

    expect(parser.emptyBackCount).toBe(2);
  });

  it('drops an answerless toggle in the 2026 export shape, whose id sits on the details element', async () => {
    const page2026 = exportPage(
      `<div style="display:contents"><ul class="toggle"><li><details id="${ids[1]}" open=""><summary>Nothing inside</summary></details></li></ul></div>` +
        toggle(ids[0], 'Has an answer', '<p class="">Answer one</p>')
    );
    const parser = await parse(page2026, clozeOn());

    const fronts = parser.payload.flatMap((deck) =>
      deck.cards.map((card) => stripTags(card.name))
    );
    expect(fronts).toEqual(['Has an answer']);
  });

  it.each([
    ['a code-span deletion', 'The <code>cell</code> is the unit of life'],
    ['a written deletion', 'The {{c1::cell}} is the unit of life'],
  ])('keeps a cloze toggle with %s and no answer', async (_what, summary) => {
    const parser = await parse(exportPage(clozeToggle(summary)), clozeOn());

    const cards = parser.payload.flatMap((deck) => deck.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0].cloze).toBe(true);
  });

  it('keeps a typed-answer toggle as it was, so its note identity does not change', async () => {
    const parser = await parse(
      exportPage(clozeToggle('What is <strong>ATP</strong>?')),
      new CardOption({ cloze: 'true', 'enable-input': 'true' })
    );

    const cards = parser.payload.flatMap((deck) => deck.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ cloze: true, enableInput: true });
  });

  it.each(['true', 'false'])(
    'drops an answerless toggle with Add Notion link on and cloze %s, whose back holds only that link',
    async (cloze) => {
      const withPageId = mixedPage.replace(
        '<article class="page sans">',
        '<article id="3b0e2c3a-0000-4000-8000-000000000009" class="page sans">'
      );
      const parser = await parse(
        withPageId,
        new CardOption({ cloze, 'add-notion-link': 'true' })
      );

      const fronts = parser.payload.flatMap((deck) =>
        deck.cards.map((card) => stripTags(card.name))
      );
      expect(fronts).toEqual(['Has an answer']);
      expect(parser.payload[0].cards[0].back).toContain('Open in Notion');
    }
  );

  it('drops an answerless toggle with Add Notion link and typed answers on, instead of asking to type the link', async () => {
    const withPageId = mixedPage.replace(
      '<article class="page sans">',
      '<article id="3b0e2c3a-0000-4000-8000-000000000009" class="page sans">'
    );
    const parser = await parse(
      withPageId,
      new CardOption({
        cloze: 'false',
        'add-notion-link': 'true',
        'enable-input': 'true',
      })
    );

    const fronts = parser.payload.flatMap((deck) =>
      deck.cards.map((card) => stripTags(card.name))
    );
    expect(fronts).toEqual(['Has an answer']);
  });

  it('keeps an MCQ toggle under cloze, which never reaches the answer check', async () => {
    const mcq = toggle(
      ids[0],
      'Which organelle makes ATP?',
      '<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> Mitochondrion</li><li><div class="checkbox checkbox-off"></div> Ribosome</li></ul>'
    );
    const parser = await parse(
      exportPage(mcq),
      new CardOption({ cloze: 'true', 'mcq-enabled': 'true' })
    );

    const cards = parser.payload.flatMap((deck) => deck.cards);
    expect(cards.map((card) => card.mcq)).toEqual([true]);
  });

  it('keeps the front-only card for a toggle whose id is not a Notion block id', async () => {
    const parser = await parse(
      exportPage(toggle('faq-1', 'Mitochondrion', '<p></p>')),
      clozeOn()
    );

    const fronts = parser.payload.flatMap((deck) =>
      deck.cards.map((card) => stripTags(card.name))
    );
    expect(fronts).toEqual(['Mitochondrion']);
  });

  it('keeps the front-only card for a one-column spreadsheet row', async () => {
    const workspace = new Workspace(true, 'fs');
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([['Mitochondrion'], ['Ribosome']]),
      'Terms'
    );
    const html = convertXLSXToHTML(
      XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
      'Terms'
    );
    const parser = new DeckParser({
      name: 'terms.html',
      settings: clozeOn(),
      files: [{ name: 'terms.html', contents: html }],
      noLimits: true,
      workspace,
    });
    await parser.writeDeckInfo(workspace);

    const fronts = parser.payload.flatMap((deck) =>
      deck.cards.map((card) => stripTags(card.name))
    );
    expect(fronts).toEqual(['Mitochondrion', 'Ribosome']);
  });
});
