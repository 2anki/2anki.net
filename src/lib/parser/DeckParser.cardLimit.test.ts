import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => {
  setupTests();
});

function toggleHtml(cardCount: number): string {
  const toggles = Array.from(
    { length: cardCount },
    (_, i) =>
      `<ul class="toggle"><li><details open=""><summary>Question ${i + 1}</summary><p>Answer ${i + 1}</p></details></li></ul>`
  ).join('\n');
  return `<html><head><title>Big deck</title></head>
<body><article class="page sans"><header><h1 class="page-title">Big deck</h1></header><div class="page-body">
${toggles}
</div></article></body></html>`;
}

function newParser(cardCount: number, cardLimit?: number): DeckParser {
  return new DeckParser({
    name: 'big-deck.html',
    settings: new CardOption({ cherry: 'false' }),
    files: [{ name: 'big-deck.html', contents: toggleHtml(cardCount) }],
    noLimits: false,
    workspace: new Workspace(true, 'fs'),
    cardLimit,
  });
}

describe('DeckParser card limit truncation', () => {
  it('delivers exactly the limit and reports the remainder as held back', async () => {
    const parser = newParser(25, 21);
    const workspace = new Workspace(true, 'fs');

    await parser.build(workspace);

    expect(parser.totalCardCount()).toBe(21);
    expect(parser.cardsHeldBack).toBe(4);
  });

  it('holds nothing back when the deck is at or under the limit', async () => {
    const parser = newParser(21, 21);
    const workspace = new Workspace(true, 'fs');

    await parser.build(workspace);

    expect(parser.totalCardCount()).toBe(21);
    expect(parser.cardsHeldBack).toBe(0);
  });

  it('leaves the deck untouched when no limit is set', async () => {
    const parser = newParser(25);
    const workspace = new Workspace(true, 'fs');

    await parser.build(workspace);

    expect(parser.totalCardCount()).toBe(25);
    expect(parser.cardsHeldBack).toBe(0);
  });
});

describe('DeckParser card limit with reversed cards', () => {
  it('counts the extra reversed cards toward the limit', async () => {
    const parser = new DeckParser({
      name: 'big-deck.html',
      settings: new CardOption({
        cherry: 'false',
        reversed: 'true',
        'basic-reversed': 'true',
      }),
      files: [{ name: 'big-deck.html', contents: toggleHtml(12) }],
      noLimits: false,
      workspace: new Workspace(true, 'fs'),
      cardLimit: 21,
    });
    const workspace = new Workspace(true, 'fs');

    await parser.build(workspace);

    expect(parser.totalCardCount()).toBe(21);
    expect(parser.cardsHeldBack).toBe(3);
  });
});
