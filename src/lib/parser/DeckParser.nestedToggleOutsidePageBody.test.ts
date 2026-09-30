import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

const wrap = (body: string) =>
  `<html><head><title>Toggles</title></head><body><article class="page sans"><header><h1 class="page-title">Toggles</h1></header><div class="page-body">${body}</div></article></body></html>`;

const nestedToggle =
  `<details open="" class="toggle" id="parent-1"><summary>Parent question?</summary><div class="indented">` +
  `<details open="" class="toggle" id="child-1"><summary>Child heading</summary><div class="indented"><p>Grandchild answer</p></div></details>` +
  `</div></details>`;

const column = (inner: string, i: number) =>
  `<div id="col-${i}" class="column">${inner}</div>`;

const columnList = (cols: string[]) =>
  `<div class="column-list">${cols.map((c, i) => column(c, i)).join('')}</div>`;

const callout = (inner: string) =>
  `<figure id="callout-1" class="callout" style="display:flex"><div style="width:100%">${inner}</div></figure>`;

async function cardsFor(html: string, options: Record<string, string>) {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'toggle.html',
    settings: new CardOption(options),
    files: [{ name: 'toggle.html', contents: html }],
    noLimits: true,
    workspace,
  });
  try {
    await parser.build(workspace);
  } catch {
    // Full .apkg packaging needs the Python venv (main checkout only); the
    // parsed cards are populated on parser.payload before packaging runs.
  }
  return parser.payload.flatMap((deck) => deck.cards);
}

describe('nested toggle not at page-body top level', () => {
  it('keeps the parent answer when a nested toggle sits inside a column', async () => {
    const cards = await cardsFor(
      wrap(columnList([nestedToggle, '<p>side</p>'])),
      {
        cherry: 'false',
      }
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain('Parent question?');
    expect(cards[0].back).toContain('Child heading');
    expect(cards[0].back).toContain('Grandchild answer');
    expect(cards[0].back.replace(/<[^>]*>/g, '').trim()).not.toBe('');
  });

  it('keeps the parent answer when a nested toggle sits inside a callout', async () => {
    const cards = await cardsFor(wrap(callout(nestedToggle)), {
      cherry: 'false',
    });

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain('Parent question?');
    expect(cards[0].back).toContain('Grandchild answer');
  });

  it('matches the deck it would produce at the page-body top level', async () => {
    const text = (html: string) => html.replace(/<[^>]*>/g, '').trim();
    const insideColumn = await cardsFor(
      wrap(columnList([nestedToggle, '<p>side</p>'])),
      { cherry: 'false' }
    );
    const atTopLevel = await cardsFor(wrap(nestedToggle), { cherry: 'false' });

    expect(insideColumn.map((c) => text(c.name))).toEqual(
      atTopLevel.map((c) => text(c.name))
    );
    expect(insideColumn.map((c) => text(c.back))).toEqual(
      atTopLevel.map((c) => text(c.back))
    );
  });
});
