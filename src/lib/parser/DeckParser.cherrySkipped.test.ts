import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

const toggle = (summary: string, body: string) =>
  `<details open="" class="toggle"><summary>${summary}</summary><div class="indented">${body}</div></details>`;

const pageOf = (body: string) =>
  `<html><head><title>T</title></head><body><article class="page sans"><header><h1 class="page-title">T</h1></header><div class="page-body">${body}</div></article></body></html>`;

const parse = async (html: string, options: Record<string, string>) => {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'cherry.html',
    settings: new CardOption(options),
    files: [{ name: 'cherry.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);
  return parser.payload;
};

const mixedPage = pageOf(
  toggle('🍒 Kept', '<p>Answer one.</p>') +
    toggle('Left out', '<p>Answer two.</p>') +
    toggle('🥑 Also left out', '<p>Answer three.</p>') +
    toggle('Another left out', '<p>Answer four.</p>')
);

describe('cherry-skipped toggle count (upload path)', () => {
  it('counts the toggles Cherry-pick left out of the deck', async () => {
    const [deck] = await parse(mixedPage, { cherry: 'true' });

    expect(deck.cards.map((card) => card.name)).toEqual([
      expect.stringContaining('Kept'),
    ]);
    expect(deck.cherrySkippedCount).toBe(3);
  });

  it('does not count toggles the avocado filter removed', async () => {
    const [deck] = await parse(mixedPage, { cherry: 'true', avocado: 'true' });

    expect(deck.cherrySkippedCount).toBe(2);
  });

  it('stays at zero with Cherry-pick off', async () => {
    const [deck] = await parse(mixedPage, { cherry: 'false', avocado: 'true' });

    expect(deck.cards).toHaveLength(3);
    expect(deck.cherrySkippedCount).toBe(0);
  });
});
