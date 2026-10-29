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
  });

  it('ships the same front-only cards as before with cloze on, once the rescue finds nothing better', async () => {
    const parser = await parse(allBlank, new CardOption({}));

    const fronts = parser.payload.flatMap((deck) =>
      deck.cards.map((card) => stripTags(card.name))
    );
    expect(fronts).toEqual(['Only an empty line inside', 'Another empty one']);
    expect(parser.inducedRule?.outcome).not.toBe('rescue_shipped');
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
