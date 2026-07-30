import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

async function cardsFor(
  html: string,
  options: Record<string, string> = { cherry: 'false' },
  name = 'toggle.html'
) {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name,
    settings: new CardOption(options),
    files: [{ name, contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);
  return parser.payload.flatMap((d) => d.cards);
}

const BLOCK_ID = '3917ab29-a11e-8047-9d97-cf0f00b3c8f7';
const OTHER_BLOCK_ID = '23b40f2c-3dba-49d5-b38b-735ce6483110';

const wrap = (body: string, title = 'Toggles') =>
  `<html><head><title>${title}</title></head><body><article class="page sans"><header><h1 class="page-title">${title}</h1></header><div class="page-body">${body}</div></article></body></html>`;

const detailsToggle = (id: string, summary: string, bodyInner: string) =>
  `<details id="${id}" class="toggle" open="" dir="auto"><summary dir="auto">${summary}</summary><div class="indented" dir="auto">${bodyInner}</div></details>`;

describe('stable card identity for the 2026 details export format', () => {
  it('carries the details block id onto the note', async () => {
    const cards = await cardsFor(
      wrap(detailsToggle(BLOCK_ID, 'What is the capital?', '<p>Tirana</p>'))
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].notionId).toBe(BLOCK_ID);
  });

  it('keeps the block id identical across deck renames and setting changes', async () => {
    const body = detailsToggle(BLOCK_ID, 'Front text', '<p>Back text</p>');
    const first = await cardsFor(wrap(body, 'Deck One'));
    const second = await cardsFor(wrap(body, '📖 Renamed Deck'), {
      cherry: 'false',
      cloze: 'true',
    });
    expect(first[0].notionId).toBe(BLOCK_ID);
    expect(second[0].notionId).toBe(BLOCK_ID);
  });

  it('gives every toggle its own block id', async () => {
    const cards = await cardsFor(
      wrap(
        detailsToggle(BLOCK_ID, 'First question', '<p>First answer</p>') +
          detailsToggle(OTHER_BLOCK_ID, 'Second question', '<p>Second answer</p>')
      )
    );
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.notionId)).toEqual([BLOCK_ID, OTHER_BLOCK_ID]);
  });

  it('leaves notionId unset when the source has no block id', async () => {
    const cards = await cardsFor(
      wrap(
        `<details class="toggle" open=""><summary>No id here</summary><div class="indented"><p>Answer</p></div></details>`
      )
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].notionId).toBeUndefined();
  });
});

describe('fan-out notes never share a block id', () => {
  it('suffixes overlapping-cloze notes with their item index', async () => {
    const list = '<ul><li>alpha</li><li>beta</li><li>gamma</li></ul>';
    const cards = await cardsFor(
      wrap(detailsToggle(BLOCK_ID, 'List question', list)),
      { cherry: 'false', cloze: 'true', 'overlapping-cloze': 'show-all' }
    );
    expect(cards.length).toBeGreaterThanOrEqual(3);
    const ids = cards.map((c) => c.notionId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [index, id] of ids.entries()) {
      expect(id).toBe(`${BLOCK_ID}::${index}`);
    }
  });

  it('suffixes the reversed companion so it cannot collide with its source', async () => {
    const cards = await cardsFor(
      wrap(detailsToggle(BLOCK_ID, 'Question side', '<p>Answer side</p>')),
      { cherry: 'false', 'basic-reversed': 'true' }
    );
    expect(cards).toHaveLength(2);
    const ids = cards.map((c) => c.notionId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(BLOCK_ID);
    expect(ids).toContain(`${BLOCK_ID}::rev`);
  });
});
