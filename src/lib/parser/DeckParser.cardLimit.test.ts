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

  it('gives no slot under the limit to a toggle whose answer is only an empty line', async () => {
    const blank =
      '<ul class="toggle"><li><details open=""><summary>Blank question</summary><p class=""></p></details></li></ul>';
    const html = toggleHtml(3).replace(
      '<div class="page-body">',
      `<div class="page-body">${blank}`
    );
    const parser = new DeckParser({
      name: 'big-deck.html',
      settings: new CardOption({ cherry: 'false', cloze: 'false' }),
      files: [{ name: 'big-deck.html', contents: html }],
      noLimits: false,
      workspace: new Workspace(true, 'fs'),
      cardLimit: 2,
    });
    const workspace = new Workspace(true, 'fs');

    await parser.build(workspace);

    expect(parser.totalCardCount()).toBe(2);
    expect(parser.cardsHeldBack).toBe(1);
  });

  it('gives no slot under the limit to an answerless Notion toggle with cloze on', async () => {
    const blank =
      '<ul id="4c0e2c3a-0000-4000-8000-000000000001" class="toggle"><li><details open=""><summary>Blank question</summary></details></li></ul>';
    const html = toggleHtml(3).replace(
      '<div class="page-body">',
      `<div class="page-body">${blank}`
    );
    const parser = new DeckParser({
      name: 'big-deck.html',
      settings: new CardOption({ cherry: 'false', cloze: 'true' }),
      files: [{ name: 'big-deck.html', contents: html }],
      noLimits: false,
      workspace: new Workspace(true, 'fs'),
      cardLimit: 2,
    });
    const workspace = new Workspace(true, 'fs');

    await parser.build(workspace);

    expect(parser.totalCardCount()).toBe(2);
    expect(parser.cardsHeldBack).toBe(1);
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

describe('DeckParser card limit on an upload that did not split', () => {
  function answerlessUpload(cardLimit?: number): DeckParser {
    const lines = Array.from(
      { length: 6 },
      (_, i) => `<p>Line ${i + 1} with no answer</p>`
    ).join('');
    return new DeckParser({
      name: 'catalog.docx.html',
      settings: new CardOption({}),
      files: [
        {
          name: 'catalog.docx.html',
          contents: `<html><head><title>Catalog</title></head><body>${lines}</body></html>`,
        },
      ],
      noLimits: false,
      workspace: new Workspace(true, 'fs'),
      cardLimit,
    });
  }

  it('still holds back a cloze card, whose answer is on the front', async () => {
    const clozeToggles = Array.from(
      { length: 3 },
      (_, i) =>
        `<ul class="toggle"><li><details open=""><summary>Capital ${i + 1} is <code>City ${i + 1}</code></summary></details></li></ul>`
    ).join('\n');
    const html = toggleHtml(0).replace(
      '<div class="page-body">',
      `<div class="page-body">${clozeToggles}`
    );
    const parser = new DeckParser({
      name: 'big-deck.html',
      settings: new CardOption({ cherry: 'false', cloze: 'true' }),
      files: [{ name: 'big-deck.html', contents: html }],
      noLimits: false,
      workspace: new Workspace(true, 'fs'),
      cardLimit: 1,
    });

    await parser.build(new Workspace(true, 'fs'));

    expect(parser.totalCardCount()).toBe(1);
    expect(parser.cardsHeldBack).toBe(2);
  });

  it('makes one front-only card per line before any cut', async () => {
    const parser = answerlessUpload();

    await parser.build(new Workspace(true, 'fs'));

    expect(parser.totalCardCount()).toBe(6);
  });

  it('holds back no card that has no answer', async () => {
    const parser = answerlessUpload(2);

    await parser.build(new Workspace(true, 'fs'));

    expect(parser.totalCardCount()).toBe(2);
    expect(parser.cardsHeldBack).toBe(0);
  });
});
