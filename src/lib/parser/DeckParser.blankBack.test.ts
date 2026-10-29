import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

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
