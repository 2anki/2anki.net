import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';
import { serializeCardsToMarkdown } from '../../services/mcp/serializeCardsToMarkdown';
import { mcpOptionsToCardSettings } from '../../services/mcp/mcpOptionsToCardSettings';

beforeEach(() => setupTests());

const toggle = (id: string, summary: string, body: string) =>
  `<ul id="${id}" class="toggle"><li><details open=""><summary>${summary}</summary>${body}</details></li></ul>`;

const exportPage = (toggles: string) =>
  `<html><head><title>Notes</title></head><body><article class="page sans"><div class="page-body">${toggles}</div></article></body></html>`;

// With cloze on, the upload path keeps every toggle as a front-only card
// whatever its back holds, so this covers the basic-card path.
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
    toggle('b', 'Only an empty line inside', '<p id="p2" class=""></p>') +
      toggle('c', 'Another empty one', '<p id="p3" class=""><br/></p>')
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
  const clozeToggle = (summary: string) =>
    `<ul class="toggle"><li><details open=""><summary>${summary}</summary><p class=""></p></details></li></ul>`;

  it('drops and counts a toggle with nothing inside and one with only an empty line', async () => {
    const parser = await parse(
      exportPage(
        toggle('a', 'Has an answer', '<p id="p1" class="">Answer one</p>') +
          toggle('b', 'Nothing inside', '') +
          toggle('c', 'Only an empty line inside', '<p id="p3" class=""></p>')
      ),
      new CardOption({ cloze: 'true' })
    );

    const fronts = parser.payload.flatMap((deck) =>
      deck.cards.map((card) => stripTags(card.name))
    );
    expect(fronts).toEqual(['Has an answer']);
    expect(parser.emptyBackCount).toBe(2);
  });

  it.each([
    ['a code-span deletion', 'The <code>cell</code> is the unit of life'],
    ['a written deletion', 'The {{c1::cell}} is the unit of life'],
  ])('keeps a cloze toggle with %s and no answer', async (_what, summary) => {
    const parser = await parse(
      exportPage(clozeToggle(summary)),
      new CardOption({ cloze: 'true' })
    );

    const cards = parser.payload.flatMap((deck) => deck.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0].cloze).toBe(true);
  });

  it('keeps the front-only card for a toggle our own converters built, which has no Notion block id', async () => {
    const converted =
      '<ul class="toggle"><li><details><summary>Mitochondrion</summary><p></p></details></li></ul>';
    const parser = await parse(
      exportPage(converted),
      new CardOption({ cloze: 'true' })
    );

    const fronts = parser.payload.flatMap((deck) =>
      deck.cards.map((card) => stripTags(card.name))
    );
    expect(fronts).toEqual(['Mitochondrion']);
  });
});
