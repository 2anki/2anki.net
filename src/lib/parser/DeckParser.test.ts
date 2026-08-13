import path from 'path';
import fs from 'fs';

import { setupTests } from '../../test/configure-jest';
import { getDeck } from '../../test/test-utils';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';
import { EmptyDeckError } from '../../usecases/jobs/EmptyDeckError';

const downloadMediaOrSkipMock = jest.fn<Promise<Buffer | null>, [string]>();

jest.mock('../../services/NotionService/helpers/downloadMediaOrSkip', () => ({
  __esModule: true,
  downloadMediaOrSkip: (url: string) => downloadMediaOrSkipMock(url),
}));

beforeEach(() => {
  setupTests();
  downloadMediaOrSkipMock.mockReset();
  downloadMediaOrSkipMock.mockResolvedValue(Buffer.from('fake-remote-bytes'));
});

test('YouTube embeds are responsive so they fit narrow screens', async () => {
  const html = `<html><head><title>Video</title></head>
<body><article class="page sans"><header><h1 class="page-title">Video</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Watch this</summary>
<figure><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">https://www.youtube.com/watch?v=dQw4w9WgXcQ</a></figure></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'video.html',
    settings: new CardOption({ cherry: 'false' }),
    files: [{ name: 'video.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const back = parser.payload[0].cards[0].back;
  expect(back).toContain('youtube.com/embed/dQw4w9WgXcQ');
  expect(back).toContain('max-width:560px');
  expect(back).not.toContain("width='560'");
});

test('deck style wraps long code blocks instead of overflowing the card', async () => {
  const html = `<html><head><title>Code</title><style>
body { line-height: 1.5; white-space: pre-wrap; }
.code-wrap { white-space: pre-wrap; word-break: break-all; }
</style></head>
<body><article class="page sans"><header><h1 class="page-title">Code</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>How to print?</summary>
<pre class="code code-wrap"><code>def foo():
    return "a very long line of code that would otherwise run off the edge of the card"</code></pre></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'code.html',
    settings: new CardOption({ cherry: 'false' }),
    files: [{ name: 'code.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const style = parser.payload[0].style ?? '';
  expect(style).toMatch(
    /(\.code-wrap|pre)[^{}]*\{[^{}]*white-space:\s*pre-wrap/
  );
  expect(parser.payload[0].cards[0].back).toContain('<pre');
});

test('deck style includes Notion highlight color rules for file uploads', async () => {
  const html = `<html><head><title>Colors</title><style>body { font-size: 16px; }</style></head>
<body><article>
<h2 class="toggle"><summary>Q</summary><div>
  Answer with <span class="highlight-red">red highlight</span>
</div></h2>
</article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'colors.html',
    settings: new CardOption({ cherry: 'false' }),
    files: [{ name: 'colors.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const style = parser.payload[0].style ?? '';
  expect(style).toContain('.highlight-red');
});

test('code blocks from HTML uploads get the themed hljs container', async () => {
  const html = `<html><head><title>Code</title></head>
<body><article class="page sans"><header><h1 class="page-title">Code</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>How to print?</summary>
<pre class="code code-wrap"><code>&lt;tag&gt; not a real element</code></pre></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'code.html',
    settings: new CardOption({ cherry: 'false' }),
    files: [{ name: 'code.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const back = parser.payload[0].cards[0].back;
  expect(back).toContain('<code class="hljs"');
  expect(back).toContain('&lt;tag&gt; not a real element');
});

test('deck style carries the selected code theme for file uploads', async () => {
  const html = `<html><head><title>Code</title></head>
<body><article class="page sans"><header><h1 class="page-title">Code</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Q</summary>
<pre class="code code-wrap"><code>x = 1</code></pre></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'code.html',
    settings: new CardOption({ cherry: 'false', 'code-theme': 'dracula' }),
    files: [{ name: 'code.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const style = parser.payload[0].style ?? '';
  expect(style).toContain('#282a36');
  expect(style).toContain('@media (prefers-color-scheme: dark)');
});

test('Toggle Headings', async () => {
  const deck = await getDeck(
    'Toggle Hea 0e02b 2.html',
    new CardOption({ cherry: 'false' })
  );
  expect(deck.cards.length).toBeGreaterThan(0);
});

test('cloze markers inside toggle content produce a cloze card with the header as Extra', async () => {
  const html = `<html><head><title>Capitals</title></head>
<body><article class="page sans"><header><h1 class="page-title">Capitals</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Australia</summary>
<p>The capital is <code>Canberra</code>, founded in <code>1913</code>.</p></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'capitals.html',
    settings: new CardOption({
      cherry: 'false',
      cloze: 'true',
      'cloze-from-toggle-content': 'true',
    }),
    files: [{ name: 'capitals.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const card = parser.payload[0].cards[0];
  expect(card.cloze).toBe(true);
  expect(card.name).toContain('{{c1::Canberra}}');
  expect(card.name).toContain('{{c2::1913}}');
  expect(card.name).not.toContain('<code>');
  expect(card.back).toContain('Australia');
  expect(card.back).not.toContain('{{c');
});

test('cloze toggle content keeps a table intact in the cloze Text', async () => {
  const html = `<html><head><title>Elements</title></head>
<body><article class="page sans"><header><h1 class="page-title">Elements</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Periodic facts</summary>
<table class="simple-table"><tbody><tr><td>Symbol</td><td><code>H</code></td></tr><tr><td>Number</td><td><code>1</code></td></tr></tbody></table></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'elements.html',
    settings: new CardOption({
      cherry: 'false',
      cloze: 'true',
      'cloze-from-toggle-content': 'true',
    }),
    files: [{ name: 'elements.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const card = parser.payload[0].cards[0];
  expect(card.cloze).toBe(true);
  expect(card.name).toContain('<table');
  expect(card.name).toContain('<td>Symbol</td>');
  expect(card.name).toContain('{{c1::H}}');
  expect(card.name).toContain('{{c2::1}}');
  expect(card.back).toContain('Periodic facts');
});

test('cloze markers in the toggle header keep the header-as-Text behaviour', async () => {
  const html = `<html><head><title>Header cloze</title></head>
<body><article class="page sans"><header><h1 class="page-title">Header cloze</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary><code>Canberra</code> was founded in <code>1913</code></summary>
<p>Source: Anki manual</p></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'header.html',
    settings: new CardOption({ cherry: 'false', cloze: 'true' }),
    files: [{ name: 'header.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const card = parser.payload[0].cards[0];
  expect(card.cloze).toBe(true);
  expect(card.name).toContain('{{c1::Canberra}}');
  expect(card.name).toContain('{{c2::1913}}');
  expect(card.back).toContain('Source: Anki manual');
});

test('Grouped cloze deletions', async () => {
  const deck = await getDeck(
    'Grouped Cloze Deletions fbf856ad7911423dbef0bfd3e3c5ce5c 3.html',
    new CardOption({
      cherry: 'false',
      cloze: 'true',
      reversed: 'true',
      'basic-reversed': 'true',
    })
  );
  expect(deck.name).toBe('Grouped Cloze Deletions');
  expect(deck.cards.length).toBe(10);
  expect(deck.cards.every((card) => card.cloze)).toBe(true);
  expect(deck.cards.some((card) => card.back.includes('{{c'))).toBe(false);
});

test('Cloze Deletions', async () => {
  const deck = await getDeck(
    'Some Cloze Deletions 1a118169ada841a99a9aaccc7eaa6775.html',
    new CardOption({
      cherry: 'false',
      reversed: 'true',
      'basic-reversed': 'true',
    })
  );
  expect(deck.cards).toHaveLength(4);
  expect(deck.cards.every((card) => card.cloze)).toBe(true);
  expect(deck.cards[0].name).toBe(
    "<div class='toggle'>{{c2::Canberra}} was founded in {{c1::1913}}.</div>"
  );
  expect(deck.cards[1].name).toBe(
    "<div class='toggle'>{{c1::Canberra::city}} was founded in {{c2::1913::year}}</div>"
  );
  expect(deck.cards[2].name).toBe(
    "<div class='toggle'>{{c1::Canberra::city}} was founded in {{c2::1913}}</div>"
  );
  expect(deck.cards[3].name).toBe(
    "<div class='toggle'>{{c1::This}} is a {{c2::cloze deletion}}</div>"
  );
  expect(deck.cards.some((card) => card.back.includes('{{c'))).toBe(false);
});

const pledgeHTML = `<!DOCTYPE html><html><head><title>Pledge</title></head>
<body>
<article id="pledge-article" class="page sans">
<header><h1 class="page-title">Pledge</h1></header>
<div class="page-body">
<ul class="toggle">
  <li>
    <details open>
      <summary>Pledge of Allegiance</summary>
      <ul class="bulleted-list">
        <li>I pledge allegiance</li>
        <li>to the flag</li>
        <li>of the United States of America</li>
      </ul>
    </details>
  </li>
</ul>
</div>
</article>
</body></html>`;

async function buildPledgeDeck(overlapping: string) {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'pledge.html',
    settings: new CardOption({
      cherry: 'false',
      cloze: 'true',
      'overlapping-cloze': overlapping,
    }),
    files: [{ name: 'pledge.html', contents: pledgeHTML }],
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);
  return parser.payload[0];
}

const countC1 = (text: string) => (text.match(/\{\{c1::/g) || []).length;

test('overlapping cloze show-all fans a toggle list into one card per item', async () => {
  const deck = await buildPledgeDeck('show-all');
  expect(deck.cards.length).toBe(3);
  for (const card of deck.cards) {
    expect(card.cloze).toBe(true);
    expect(countC1(card.name)).toBe(1);
  }
  expect(deck.cards[0].name).toContain('{{c1::I pledge allegiance}}');
  expect(deck.cards[0].name).toContain('to the flag');
  expect(deck.cards[0].name).toContain('of the United States of America');
});

test('overlapping cloze windowed keeps only the neighbouring lines', async () => {
  const deck = await buildPledgeDeck('windowed');
  expect(deck.cards.length).toBe(3);
  const middle = deck.cards[1].name;
  expect(countC1(middle)).toBe(1);
  expect(middle).toContain('I pledge allegiance');
  expect(middle).toContain('{{c1::to the flag}}');
  expect(middle).toContain('of the United States of America');
  expect(deck.cards[0].name).not.toContain('of the United States of America');
});

test('overlapping cloze off leaves the single toggle card untouched', async () => {
  const deck = await buildPledgeDeck('off');
  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].name).toContain('Pledge of Allegiance');
  expect(deck.cards[0].name).not.toContain('{{c1::');
});

test('overlapping cloze falls back to one card when the list has under 2 items', async () => {
  const workspace = new Workspace(true, 'fs');
  const oneItemHTML = `<!DOCTYPE html><html><head><title>Solo</title></head>
<body>
<article id="solo-article" class="page sans">
<header><h1 class="page-title">Solo</h1></header>
<div class="page-body">
<ul class="toggle">
  <li>
    <details open>
      <summary>Single</summary>
      <ul class="bulleted-list"><li>only line</li></ul>
    </details>
  </li>
</ul>
</div>
</article>
</body></html>`;
  const parser = new DeckParser({
    name: 'solo.html',
    settings: new CardOption({
      cherry: 'false',
      cloze: 'true',
      'overlapping-cloze': 'show-all',
    }),
    files: [{ name: 'solo.html', contents: oneItemHTML }],
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);
  const deck = parser.payload[0];
  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].name).toContain('Single');
  expect(deck.cards[0].name).not.toContain('{{c1::');
});

async function buildFragmentedListDeck(overlapping: string) {
  const fixturePath = path.join(
    __dirname,
    '../../test/fixtures/notion-fragmented-numbered-list.html'
  );
  const contents = fs.readFileSync(fixturePath).toString();
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'notion-fragmented-numbered-list.html',
    settings: new CardOption({
      cherry: 'false',
      cloze: 'true',
      'overlapping-cloze': overlapping,
    }),
    files: [{ name: 'notion-fragmented-numbered-list.html', contents }],
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);
  return parser.payload[0];
}

test('overlapping cloze show-all turns a fragmented page list into N cloze notes', async () => {
  const deck = await buildFragmentedListDeck('show-all');
  expect(deck.cards.length).toBe(5);
  for (const card of deck.cards) {
    expect(card.cloze).toBe(true);
    expect(countC1(card.name)).toBe(1);
  }
  expect(deck.cards[0].name).toContain('{{c1::Mercury}}');
  expect(deck.cards[0].name).toContain('Jupiter');
  expect(deck.cards[4].name).toContain('{{c1::Jupiter}}');
});

test('overlapping cloze windowed limits a fragmented page list to neighbours', async () => {
  const deck = await buildFragmentedListDeck('windowed');
  expect(deck.cards.length).toBe(5);
  const middle = deck.cards[2].name;
  expect(countC1(middle)).toBe(1);
  expect(middle).toContain('Venus');
  expect(middle).toContain('{{c1::Earth}}');
  expect(middle).toContain('Mars');
  expect(middle).not.toContain('Mercury');
  expect(middle).not.toContain('Jupiter');
});

test('overlapping cloze off leaves a fragmented page list as one card per item', async () => {
  const deck = await buildFragmentedListDeck('off');
  expect(deck.cards.length).toBe(5);
  expect(deck.cards[0].name).toContain('Mercury');
  expect(deck.cards[0].name).not.toContain('{{c1::');
  expect(deck.cards[0].name).not.toContain('Venus');
  expect(deck.cards[4].name).toContain('Jupiter');
});

async function buildPageDeck(fixture: string, overlapping: string) {
  const fixturePath = path.join(__dirname, '../../test/fixtures', fixture);
  const contents = fs.readFileSync(fixturePath).toString();
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: fixture,
    settings: new CardOption({
      cherry: 'false',
      cloze: 'true',
      'overlapping-cloze': overlapping,
    }),
    files: [{ name: fixture, contents }],
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);
  return parser.payload[0];
}

test('overlapping cloze show-all turns a single prose paragraph into N cloze notes', async () => {
  const deck = await buildPageDeck('notion-single-paragraph.html', 'show-all');
  expect(deck.cards.length).toBe(3);
  for (const card of deck.cards) {
    expect(card.cloze).toBe(true);
    expect(countC1(card.name)).toBe(1);
  }
  expect(deck.cards[0].name).toContain('{{c1::You should not bother others}}');
  expect(deck.cards[0].name).toContain('you should be kind and helpful');
  expect(deck.cards[2].name).toContain(
    '{{c1::and otherwise you may do as you like}}'
  );
});

test('overlapping cloze off leaves a single prose paragraph as one card', async () => {
  const deck = await buildPageDeck('notion-single-paragraph.html', 'off');
  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].name).toContain('You should not bother others');
  expect(deck.cards[0].name).not.toContain('{{c1::');
});

test('overlapping cloze leaves a multi-paragraph page untouched', async () => {
  const deck = await buildPageDeck('notion-multi-paragraph.html', 'show-all');
  for (const card of deck.cards) {
    expect(card.name).not.toContain('{{c1::');
  }
  expect(
    deck.cards.some((c) => c.name.includes('Mercury is the closest'))
  ).toBe(true);
});

test('overlapping cloze show-all turns a poem of one-line blocks into N cloze notes', async () => {
  const deck = await buildPageDeck('notion-poem-lines.html', 'show-all');
  expect(deck.cards.length).toBe(7);
  for (const card of deck.cards) {
    expect(card.cloze).toBe(true);
    expect(countC1(card.name)).toBe(1);
  }
  expect(deck.cards[0].name).toContain('{{c1::Over the hills we go}}');
  expect(deck.cards[0].name).toContain('Under a wide blue sky');
  expect(deck.cards[6].name).toContain('{{c1::Sing for the falling night}}');
  expect(deck.cards.some((c) => c.name.includes('(Come along now!)'))).toBe(
    true
  );
});

test('overlapping cloze windowed limits a poem to neighbouring lines', async () => {
  const deck = await buildPageDeck('notion-poem-lines.html', 'windowed');
  expect(deck.cards.length).toBe(7);
  for (const card of deck.cards) {
    expect(card.cloze).toBe(true);
    expect(countC1(card.name)).toBe(1);
  }
});

test('overlapping cloze off leaves a poem as one basic card per line', async () => {
  const deck = await buildPageDeck('notion-poem-lines.html', 'off');
  expect(deck.cards.length).toBe(7);
  for (const card of deck.cards) {
    expect(card.name).not.toContain('{{c1::');
  }
  expect(deck.cards[0].name).toContain('Over the hills we go');
});

test('overlapping cloze leaves a multi-line prose page untouched', async () => {
  const deck = await buildPageDeck('notion-prose-lines.html', 'show-all');
  for (const card of deck.cards) {
    expect(card.name).not.toContain('{{c1::');
  }
  expect(
    deck.cards.some((c) => c.name.includes('The river rose overnight'))
  ).toBe(true);
});

test('overlapping cloze skips a page that mixes lines with a heading', async () => {
  const deck = await buildPageDeck('notion-mixed-lines.html', 'show-all');
  for (const card of deck.cards) {
    expect(card.name).not.toContain('{{c1::');
  }
});

async function buildDeckFromFiles(
  entryName: string,
  files: { name: string; contents: string }[],
  overlapping: string
) {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: entryName,
    settings: new CardOption({
      cherry: 'false',
      cloze: 'true',
      'overlapping-cloze': overlapping,
    }),
    files,
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);
  return parser.payload;
}

test('overlapping cloze fires on the real Notion list wrapper, not just idealized HTML', async () => {
  const deck = await buildPageDeck(
    'notion-real-numbered-list.html',
    'show-all'
  );
  expect(deck.cards.length).toBe(5);
  for (const card of deck.cards) {
    expect(card.cloze).toBe(true);
    expect(countC1(card.name)).toBe(1);
  }
  expect(deck.cards[0].name).toContain('{{c1::Mercury}}');
  expect(deck.cards[0].name).toContain('Jupiter');
  expect(deck.cards[4].name).toContain('{{c1::Jupiter}}');
});

test('the real Notion list wrapper stays basic when overlapping cloze is off', async () => {
  const deck = await buildPageDeck('notion-real-numbered-list.html', 'off');
  expect(deck.cards.length).toBe(5);
  for (const card of deck.cards) {
    expect(card.name).not.toContain('{{c1::');
  }
  expect(deck.cards[0].name).toContain('Mercury');
  expect(deck.cards[0].name).not.toContain('Venus');
});

test('overlapping cloze reaches a real Notion subpage through link recursion', async () => {
  const parentPath = path.join(
    __dirname,
    '../../test/fixtures/notion-real-parent-with-link.html'
  );
  const subpagePath = path.join(
    __dirname,
    '../../test/fixtures/notion-real-numbered-list.html'
  );
  const parent = fs.readFileSync(parentPath).toString();
  const subpage = fs.readFileSync(subpagePath).toString();
  const decks = await buildDeckFromFiles(
    'Solar System 3727ab29a11e805099c5efe852c0ce3c.html',
    [
      {
        name: 'Solar System 3727ab29a11e805099c5efe852c0ce3c.html',
        contents: parent,
      },
      {
        name: 'Solar System/Planets 3727ab29a11e807bbf51f5be7dc2959a.html',
        contents: subpage,
      },
    ],
    'show-all'
  );
  const subDeck = decks.find((d) => d.name === 'Solar System::Planets');
  expect(subDeck).toBeDefined();
  expect(subDeck!.cards.length).toBe(5);
  for (const card of subDeck!.cards) {
    expect(card.cloze).toBe(true);
    expect(countC1(card.name)).toBe(1);
  }
  expect(subDeck!.cards[0].name).toContain('{{c1::Mercury}}');
});

test('Colours', async () => {
  const deck = await getDeck(
    'Colours 0519bf7e86d84ee4ba710c1b7ff7438e.html',
    new CardOption({ cherry: 'false' })
  );
  expect(deck.cards[0].back.includes('block-color')).toBe(true);
});

test('Nested Toggles', async () => {
  const deck = await getDeck(
    'Nested Toggles.html',
    new CardOption({
      cherry: 'true',
      reversed: 'true',
      'basic-reversed': 'true',
    })
  );
  expect(deck.cards.length).toBe(8);
  expect(
    deck.cards.some((card) => !card.cloze && card.back.includes('{{c'))
  ).toBe(false);
});

test('Global Tags', async () => {
  const deck = await getDeck(
    'Global Tag Support.html',
    new CardOption({ tags: 'true', cherry: 'false' })
  );
  expect(deck.cards[0].tags.includes('global')).toBe(true);
});

test('global tags per file are preserved in multi-file uploads', async () => {
  const fixtureDir = path.join(__dirname, '../../test/fixtures');
  const fileAContents = fs
    .readFileSync(path.join(fixtureDir, 'multi-file-tags-a.html'))
    .toString();
  const fileBContents = fs
    .readFileSync(path.join(fixtureDir, 'multi-file-tags-b.html'))
    .toString();

  const files = [
    { name: 'multi-file-tags-a.html', contents: fileAContents },
    { name: 'multi-file-tags-b.html', contents: fileBContents },
  ];

  const workspace = new Workspace(true, 'fs');
  const settings = new CardOption({ tags: 'true', cherry: 'false' });
  const parser = new DeckParser({
    name: 'multi-file-tags-a.html',
    settings,
    files,
    noLimits: true,
    workspace,
  });

  const decks = parser.handleHTML(
    'multi-file-tags-b.html',
    fileBContents,
    '',
    parser.payload
  );
  parser.payload = decks;

  expect(parser.payload.length).toBe(2);

  parser.customExporter.save = jest.fn().mockResolvedValue('');
  await parser.build(workspace);

  const deckA = parser.payload[0];
  const deckB = parser.payload[1];

  expect(deckA.cards.length).toBe(1);
  expect(deckB.cards.length).toBe(1);

  expect(deckA.cards[0].tags).toContain('alpha-tag');
  expect(deckA.cards[0].tags).not.toContain('beta-tag');

  expect(deckB.cards[0].tags).toContain('beta-tag');
  expect(deckB.cards[0].tags).not.toContain('alpha-tag');
});

test('global tags on a parent page carry into its sub-pages', async () => {
  const parentHtml = `<html><head><title>Parent</title></head><body><article class="page sans"><header><h1 class="page-title">Parent</h1></header><div class="page-body">
<p><del>parenttag</del></p>
<ul class="toggle"><li><details open=""><summary>Parent Q</summary><p>Parent A</p></details></li></ul>
<figure class="link-to-page"><a href="sub.html">Sub</a></figure>
</div></article></body></html>`;
  const subHtml = `<html><head><title>Sub</title></head><body><article class="page sans"><header><h1 class="page-title">Sub</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Sub Q</summary><p>Sub A</p></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'parent.html',
    settings: new CardOption({ tags: 'true', cherry: 'false' }),
    files: [
      { name: 'parent.html', contents: parentHtml },
      { name: 'sub.html', contents: subHtml },
    ],
    noLimits: true,
    workspace,
  });

  parser.customExporter.save = jest.fn().mockResolvedValue('');
  await parser.build(workspace);

  const parentDeck = parser.payload[0];
  const subDeck = parser.payload.find((d) => d.name.includes('Sub'));
  expect(parentDeck.cards[0].tags).toContain('parenttag');
  expect(subDeck).toBeDefined();
  expect(subDeck!.cards[0].tags).toContain('parenttag');
});

test('a plain toggle card with a short answer becomes a real input card when no bold markup is present', async () => {
  const html = `<html><head><title>Japanese</title></head><body><article class="page sans"><header><h1 class="page-title">Japanese</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>schedule</summary><p>予定</p></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'japanese.html',
    settings: new CardOption({
      cherry: 'false',
      cloze: 'false',
      'enable-input': 'true',
    }),
    files: [{ name: 'japanese.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const card = parser.payload[0].cards[0];
  expect(card.enableInput).toBe(true);
  expect(card.answer).toBe('予定');
  expect(card.name).toContain('{{type:Input}}');
});

test('a toggle card with a long or multi-line answer stays a plain input-disabled card', async () => {
  const html = `<html><head><title>Notes</title></head><body><article class="page sans"><header><h1 class="page-title">Notes</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>What is mitosis?</summary><p>Mitosis is the process by which a single eukaryotic cell divides to produce two genetically identical daughter cells.</p></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'notes.html',
    settings: new CardOption({
      cherry: 'false',
      cloze: 'false',
      'enable-input': 'true',
    }),
    files: [{ name: 'notes.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const card = parser.payload[0].cards[0];
  expect(card.enableInput).toBe(true);
  expect(card.answer).toBe('');
  expect(card.name).not.toContain('{{type:Input}}');
});

test('a bold-marked answer still takes priority over the plain-back fallback', async () => {
  const html = `<html><head><title>Cells</title></head><body><article class="page sans"><header><h1 class="page-title">Cells</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>The powerhouse of the cell is the <strong>mitochondrion</strong></summary><p>Found in eukaryotic cells</p></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'cells.html',
    settings: new CardOption({
      cherry: 'false',
      cloze: 'false',
      'enable-input': 'true',
    }),
    files: [{ name: 'cells.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const card = parser.payload[0].cards[0];
  expect(card.answer).toBe('mitochondrion');
  expect(card.name).not.toContain('<strong>');
});

test.todo('Test Basic Card');

test('Markdown empty deck', async () => {
  const deck = await getDeck(
    'empty-deck.md',
    new CardOption({
      'markdown-nested-bullet-points': 'true',
    })
  );
  expect(deck.name).toBe('Empty Deck');
  expect(deck.cards.length).toBe(0);
});

test('tryExperimental on a Markdown file throws EmptyDeckError with markdown sourceFormat', () => {
  const fixturePath = path.join(__dirname, '../../test/fixtures/empty-deck.md');
  const contents = fs.readFileSync(fixturePath).toString();
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'empty-deck.md',
    settings: new CardOption({}),
    files: [{ name: 'empty-deck.md', contents }],
    noLimits: true,
    workspace,
  });

  expect(() => parser.tryExperimental()).toThrow(EmptyDeckError);

  try {
    parser.tryExperimental();
  } catch (err) {
    expect(err).toBeInstanceOf(EmptyDeckError);
    expect((err as EmptyDeckError).sourceFormat).toBe('markdown');
  }
});

test('tryExperimental on an HTML file throws EmptyDeckError without markdown sourceFormat', () => {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'empty.html',
    settings: new CardOption({}),
    files: [{ name: 'empty.html', contents: '<html><body></body></html>' }],
    noLimits: true,
    workspace,
  });

  try {
    parser.tryExperimental();
  } catch (err) {
    expect(err).toBeInstanceOf(EmptyDeckError);
    expect((err as EmptyDeckError).sourceFormat).toBeUndefined();
  }
});

test('Markdown nested bullet points', async () => {
  const deck = await getDeck(
    'simple-deck.md',
    new CardOption({
      'markdown-nested-bullet-points': 'true',
      reversed: 'false',
      'basic-reversed': 'false',
    })
  );

  expect(deck.name).toBe('Simple Deck');

  expect(deck.cards[0].name).toBe(
    '<ul>\n<li>' + 'What is the capital of Kenya?' + '</li>\n</ul>\n'
  );
  expect(deck.cards[0].back).toBe('<p>Nairobi</p>\n');
  expect(deck.cards[1].name).toBe(
    '<ul>\n<li>' + 'What is the capital of Norway' + '</li>\n</ul>\n'
  );
  expect(deck.cards[1].back).toBe('<p>Oslo</p>\n');
  expect(deck.cards[2].name).toBe(
    '<ul>\n<li>' + 'What is the capital of Sweden' + '</li>\n</ul>\n'
  );
  expect(deck.cards[2].back).toBe('<p>Stockholm</p>\n');
  expect(deck.cards[3].name).toBe(
    '<ul>\n<li>' + 'What is the capital of Finland' + '</li>\n</ul>\n'
  );
  expect(deck.cards[3].back).toBe('<p><strong>Helsinki</strong></p>\n');
  expect(deck.cards.length).toBe(4);
});

test('Markdown reversed cards keep numeric sort order', async () => {
  const fixturePath = path.join(
    __dirname,
    '../../test/fixtures/simple-deck.md'
  );
  const contents = fs.readFileSync(fixturePath).toString();
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'simple-deck.md',
    settings: new CardOption({
      'markdown-nested-bullet-points': 'true',
      reversed: 'true',
      'basic-reversed': 'false',
    }),
    files: [{ name: 'simple-deck.md', contents }],
    noLimits: true,
    workspace,
  });

  parser.customExporter.save = jest.fn().mockResolvedValue('');
  await parser.build(workspace);

  const deck = parser.payload[0];

  expect(deck.cards.map((card) => card.number)).toEqual([0, 1, 2, 3]);
  expect(deck.cards).not.toContainEqual(
    expect.objectContaining({ number: -1 })
  );
});

test('Markdown nested bullets auto-detected without explicit setting', () => {
  const fixturePath = path.join(
    __dirname,
    '../../test/fixtures/notion-nested-bullets.md'
  );
  const contents = fs.readFileSync(fixturePath).toString();
  const info = [{ name: 'notion-nested-bullets.md', contents }];
  const parser = new DeckParser({
    name: 'notion-nested-bullets.md',
    settings: new CardOption({ reversed: 'false', 'basic-reversed': 'false' }),
    files: info,
    noLimits: true,
    workspace: new Workspace(true, 'fs'),
  });
  expect(parser.payload.length).toBe(1);
  expect(parser.payload[0].cards.length).toBe(2);
});

test('Notion new export: display:contents and fragmented ul.toggle', async () => {
  const deck = await getDeck(
    'notion-new-export-nested.html',
    new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
  );

  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].name).toContain('Parent');
  expect(deck.cards[0].back).toContain('Child');
  expect(deck.cards[0].back).toContain('details');
  expect(deck.cards[0].back).toContain('summary');
});

test('Notion new export: display:contents for toggles', async () => {
  const deck = await getDeck(
    'Toggles test 2cd7ab29a11e80bea100ed002a880884.html',
    new CardOption({
      'max-one-toggle-per-card': 'true',
      cherry: 'false',
      'enable-input': 'false',
    })
  );

  // Should extract 2 cards from this structure
  expect(deck.cards.length).toBe(2);

  // First card should be the simple Albania question
  expect(deck.cards[0].name).toContain('Albania');
  expect(deck.cards[0].back).toContain('Tirana');

  // Second card should be the Japan greetings with nested content
  expect(deck.cards[1].name).toBeDefined();
  expect(deck.cards[1].back).toBeDefined();

  // Check that nested Japanese greetings are preserved as functional toggles
  expect(deck.cards[1].back).toContain('おはようございます');
  expect(deck.cards[1].back).toContain('Ohayō gozaimasu');
  expect(deck.cards[1].back).toContain('こんにちは');
  expect(deck.cards[1].back).toContain('Konnichiwa');
  expect(deck.cards[1].back).toContain('details');
  expect(deck.cards[1].back).toContain('summary');
});

test('Notion figure image: img src uses filename not full subfolder path', async () => {
  const deck = await getDeck(
    'notion-figure-image.html',
    new CardOption({ cherry: 'false' })
  );
  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].back).toContain('src="screenshot.png"');
  expect(deck.cards[0].back).not.toContain('src="Test%20Deck/');
  expect(deck.cards[0].back).not.toContain('src="Test Deck/');
});

test('Notion figure image: embeds image when file found via backslash path (Windows ZIP)', async () => {
  const htmlPath = path.join(
    __dirname,
    '../../test/fixtures/notion-figure-image.html'
  );
  const htmlContents = fs.readFileSync(htmlPath).toString();
  const fakeImageData = Buffer.from('fake-image-data');

  const parser = new DeckParser({
    name: 'notion-figure-image.html',
    settings: new CardOption({ cherry: 'false' }),
    files: [
      { name: 'notion-figure-image.html', contents: htmlContents },
      { name: 'Test Deck\\screenshot.png', contents: fakeImageData },
    ],
    noLimits: true,
    workspace: new Workspace(true, 'fs'),
  });
  await parser.build(new Workspace(true, 'fs'));
  const deck = parser.payload[0];

  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].media.length).toBe(1);
  expect(deck.cards[0].back).not.toContain('src="Test%20Deck/');
  expect(deck.cards[0].back).not.toContain('src="Test Deck/');
});

test('Notion figure image: resolves S3 presigned URL from local ZIP entry', async () => {
  const html = `<html><head><title>Deck</title></head><body><article>
<ul class="toggle"><li><details open="">
  <summary>Question</summary>
  <div><img src="https://prod-files-secure.s3.us-west-2.amazonaws.com/ws-id/file-id/screenshot.png?X-Amz-Expires=3600&amp;X-Amz-Signature=abc" /></div>
</details></li></ul>
</article></body></html>`;
  const fakeImageData = Buffer.from('fake-png-bytes');
  const ws = new Workspace(true, 'fs');

  const parser = new DeckParser({
    name: 'deck.html',
    settings: new CardOption({ cherry: 'false' }),
    files: [
      { name: 'deck.html', contents: html },
      { name: 'Deck Assets/screenshot.png', contents: fakeImageData },
    ],
    noLimits: true,
    workspace: ws,
  });

  await parser.writeDeckInfo(ws);
  const deck = parser.payload[0];

  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].media.length).toBe(1);
  expect(deck.cards[0].back).not.toContain('prod-files-secure.s3');
  expect(deck.cards[0].back).toMatch(/src="[^"]+\.png"/);
});

test('Notion new export: deeply nested toggles (3 levels)', async () => {
  const deck = await getDeck(
    'Notion Page grandchildren 2ce7ab29a11e809998e3d22ed65fc5f2.html',
    new CardOption({
      'max-one-toggle-per-card': 'true',
      cherry: 'false',
      'enable-input': 'false',
    })
  );

  expect(deck.cards.length).toBe(1);

  expect(deck.cards[0].name).toContain('Parent');
  expect(deck.cards[0].back).toContain('Grand child');

  expect(deck.cards[0].back).toContain('Child');
  expect(deck.cards[0].back).toContain('details');
  expect(deck.cards[0].back).toContain('summary');
});

test('nested toggle summaries are not forcibly bolded', async () => {
  const deck = await getDeck(
    'Notion Page grandchildren 2ce7ab29a11e809998e3d22ed65fc5f2.html',
    new CardOption({
      'max-one-toggle-per-card': 'true',
      cherry: 'false',
      'enable-input': 'false',
    })
  );

  expect(deck.cards.length).toBe(1);
  const summaryMatches =
    deck.cards[0].back.match(/<summary[^>]*>([\s\S]*?)<\/summary>/g) || [];
  expect(summaryMatches.length).toBeGreaterThan(0);
  for (const match of summaryMatches) {
    expect(match).not.toContain('<strong>');
  }
});

test('nested toggle summaries preserve non-empty content', async () => {
  const deck = await getDeck(
    'Notion Page grandchildren 2ce7ab29a11e809998e3d22ed65fc5f2.html',
    new CardOption({
      'max-one-toggle-per-card': 'true',
      cherry: 'false',
      'enable-input': 'false',
    })
  );

  expect(deck.cards.length).toBe(1);
  const back = deck.cards[0].back;
  const summaryMatches =
    back.match(/<summary[^>]*>([\s\S]*?)<\/summary>/g) || [];
  expect(summaryMatches.length).toBeGreaterThan(0);
  for (const match of summaryMatches) {
    const inner = match
      .replace(/<summary[^>]*>/g, '')
      .replace(/<\/summary>/g, '')
      .trim();
    expect(inner.length).toBeGreaterThan(0);
  }
});

test('Nested toggles produce one card without maxOne (new format)', async () => {
  const deck = await getDeck(
    'Notion Page grandchildren 2ce7ab29a11e809998e3d22ed65fc5f2.html',
    new CardOption({
      'max-one-toggle-per-card': 'false',
      cherry: 'false',
      all: 'true',
      'enable-input': 'false',
    })
  );

  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].name).toContain('Parent');
  expect(deck.cards[0].back).toContain('Child');
});

test('Nested toggles with cloze markers in content produce one cloze card (legacy format)', async () => {
  const deck = await getDeck(
    'Nested Toggles.html',
    new CardOption({
      'max-one-toggle-per-card': 'false',
      cherry: 'false',
      all: 'true',
      'enable-input': 'false',
      cloze: 'true',
      'cloze-from-toggle-content': 'true',
    })
  );

  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].cloze).toBe(true);
  expect(deck.cards[0].name).toContain('Capital');
  expect(deck.cards[0].name).toContain('{{c1::Sweden}}');
  expect(deck.cards[0].back).toContain('Parent');
});

test('cloze toggle content stays a basic card when cloze-from-toggle-content is off', async () => {
  const html = `<html><head><title>Capitals</title></head>
<body><article class="page sans"><header><h1 class="page-title">Capitals</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Australia</summary>
<p>The capital is <code>Canberra</code>, founded in <code>1913</code>.</p></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'capitals.html',
    settings: new CardOption({ cherry: 'false', cloze: 'true' }),
    files: [{ name: 'capitals.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const card = parser.payload[0].cards[0];
  expect(card.cloze).toBe(true);
  expect(card.name).toContain('Australia');
  expect(card.name).not.toContain('{{c');
  expect(card.back).toContain('Canberra');
  expect(card.back).not.toContain('{{c');
});

test('bullet points inside toggle are preserved (legacy format)', async () => {
  const deck = await getDeck(
    'toggle-with-bullets.html',
    new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
  );

  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].name).toContain('symptoms');
  expect(deck.cards[0].back).toContain('<li');
  expect(deck.cards[0].back).toContain('Fever');
  expect(deck.cards[0].back).toContain('Cough');
  expect(deck.cards[0].back).toContain('Fatigue');
});

test('bullet points preserved alongside nested toggles (legacy format)', async () => {
  const deck = await getDeck(
    'toggle-with-bullets-and-nested-toggle.html',
    new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
  );

  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].name).toContain('Cardiology');
  expect(deck.cards[0].back).toContain('Study of the heart');
  expect(deck.cards[0].back).toContain('Includes diagnosis and treatment');
  expect(deck.cards[0].back).toContain('<li');
  expect(deck.cards[0].back).not.toContain('Sub-specialties');
});

test('bullet points inside toggle are preserved (new format)', async () => {
  const deck = await getDeck(
    'notion-new-export-bullets-in-toggle.html',
    new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
  );

  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].name).toContain('symptoms');
  expect(deck.cards[0].back).toContain('<li');
  expect(deck.cards[0].back).toContain('Fever');
  expect(deck.cards[0].back).toContain('Cough');
  expect(deck.cards[0].back).toContain('Fatigue');
});

test('empty paragraphs preserved as spacing in card back', async () => {
  const deck = await getDeck(
    'toggle-with-spacing.html',
    new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
  );

  expect(deck.cards.length).toBe(1);
  expect(deck.cards[0].back).toContain('Sustained elevation');
  expect(deck.cards[0].back).toContain('end-organ damage');
  const emptyParagraphs = deck.cards[0].back.match(/<p[^>]*><\/p>/g);
  expect(emptyParagraphs).not.toBeNull();
});

test('refresh emoji reverses an uploaded card even when reverse settings are off', async () => {
  const fixturePath = path.join(
    __dirname,
    '../../test/fixtures/refresh-emoji-toggle.html'
  );
  const contents = fs.readFileSync(fixturePath).toString();
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'refresh-emoji-toggle.html',
    settings: new CardOption({
      reversed: 'false',
      'basic-reversed': 'false',
      cherry: 'false',
    }),
    files: [{ name: 'refresh-emoji-toggle.html', contents }],
    noLimits: true,
    workspace,
  });

  expect(parser.payload[0].cards.length).toBe(2);
  parser.customExporter.save = jest.fn().mockResolvedValue('');
  await parser.build(workspace);

  const deck = parser.payload[0];
  expect(deck.cards.length).toBe(3);

  const forwardFrance = deck.cards.find((c) =>
    c.name.includes('capital of France')
  );
  expect(forwardFrance?.back).toContain('Paris');

  const germany = deck.cards.find((c) => c.name.includes('capital of Germany'));
  expect(germany?.back).toContain('Berlin');

  const reversedFrance = deck.cards.find((c) => c.name.includes('Paris'));
  expect(reversedFrance?.back).toContain('capital of France');

  for (const card of deck.cards) {
    expect(card.name).not.toContain('🔄');
    expect(card.name).not.toContain('&#x1F504');
    expect(card.back).not.toContain('🔄');
    expect(card.back).not.toContain('&#x1F504');
  }
});

describe('removeNewlinesInSVGPathAttributeD', () => {
  const newParser = () =>
    new DeckParser({
      name: 'svg-test',
      settings: new CardOption({}),
      files: [],
      noLimits: false,
      workspace: new Workspace(true, 'fs'),
    });

  it('strips newlines from a path d attribute', () => {
    const input = '<svg><path d="M0,0\nL10,10\nL20,0"/></svg>';
    expect(newParser().removeNewlinesInSVGPathAttributeD(input)).toBe(
      '<svg><path d="M0,0L10,10L20,0"/></svg>'
    );
  });

  it('trims leading and trailing whitespace inside d', () => {
    const input = '<path d="\n  M0,0 L10,10  \n"/>';
    expect(newParser().removeNewlinesInSVGPathAttributeD(input)).toBe(
      '<path d="M0,0 L10,10"/>'
    );
  });

  it('leaves d attributes on non-path elements untouched', () => {
    const input = '<text d="\nignore me\n">hi</text>';
    expect(newParser().removeNewlinesInSVGPathAttributeD(input)).toBe(input);
  });

  it('leaves sibling attributes on path untouched', () => {
    const input =
      '<path fill="red" d="M0,0\nL1,1" stroke="blue" stroke-width="2"/>';
    expect(newParser().removeNewlinesInSVGPathAttributeD(input)).toBe(
      '<path fill="red" d="M0,0L1,1" stroke="blue" stroke-width="2"/>'
    );
  });

  it('handles single-quoted d attributes', () => {
    const input = "<path d='M0,0\nL5,5'/>";
    expect(newParser().removeNewlinesInSVGPathAttributeD(input)).toBe(
      "<path d='M0,0L5,5'/>"
    );
  });

  it('processes multiple path elements in one document', () => {
    const input = '<svg><path d="M0,0\nL1,1"/><path d="\nM2,2\nL3,3\n"/></svg>';
    expect(newParser().removeNewlinesInSVGPathAttributeD(input)).toBe(
      '<svg><path d="M0,0L1,1"/><path d="M2,2L3,3"/></svg>'
    );
  });

  it('returns input unchanged when there are no path elements', () => {
    const input = '<div><p>no svg here</p></div>';
    expect(newParser().removeNewlinesInSVGPathAttributeD(input)).toBe(input);
  });
});

describe('notion-html-2024 regression corpus', () => {
  const fixtureDir = path.join(__dirname, '__fixtures__/notion-html-2024');
  const html = fs.readFileSync(path.join(fixtureDir, 'index.html')).toString();
  const pngPath = path.join(
    fixtureDir,
    'notion-html-2024/pasted-screenshot.png'
  );
  const pngContents = fs.readFileSync(pngPath);

  function buildParser(settings: CardOption) {
    return new DeckParser({
      name: 'index.html',
      settings,
      files: [
        { name: 'index.html', contents: html },
        {
          name: 'notion-html-2024/pasted-screenshot.png',
          contents: pngContents,
        },
      ],
      noLimits: true,
      workspace: new Workspace(true, 'fs'),
    });
  }

  test('Bug 1: toggle with bulleted-list children produces one card with list items', async () => {
    const parser = buildParser(
      new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
    );
    parser.customExporter.save = jest.fn().mockResolvedValue('');
    await parser.build(new Workspace(true, 'fs'));

    const symptomCard = parser.payload[0].cards.find(
      (c) => c.name.includes('influenza') || c.name.includes('symptoms')
    );
    expect(symptomCard).toBeDefined();
    expect(symptomCard!.back).toContain('<li');
    expect(symptomCard!.back).toContain('Fever');
    expect(symptomCard!.back).toContain('Myalgia');
    expect(symptomCard!.back).toContain('Cough');
  });

  test('Bug 2: pasted screenshot image is embedded into the card media list', async () => {
    const parser = buildParser(
      new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
    );
    parser.customExporter.save = jest.fn().mockResolvedValue('');
    await parser.build(new Workspace(true, 'fs'));

    const imageCard = parser.payload[0].cards.find(
      (c) => c.name.includes('diagram') || c.name.includes('Diagram')
    );
    expect(imageCard).toBeDefined();
    expect(imageCard!.media.length).toBeGreaterThan(0);
    expect(imageCard!.back).toMatch(/src="[^"]+\.png"/);
    expect(imageCard!.back).not.toContain(
      'src="notion-html-2024/pasted-screenshot.png"'
    );
  });

  test('Bug 3: adjacent code siblings in a cloze summary produce exactly one cloze token', async () => {
    const parser = buildParser(
      new CardOption({
        'max-one-toggle-per-card': 'true',
        cherry: 'false',
        cloze: 'true',
      })
    );
    parser.customExporter.save = jest.fn().mockResolvedValue('');
    await parser.build(new Workspace(true, 'fs'));

    const clozeCard = parser.payload[0].cards.find(
      (c) =>
        c.name.includes('cloze concept') || c.back.includes('cloze concept')
    );
    expect(clozeCard).toBeDefined();
    const clozeTokens = (clozeCard!.name.match(/\{\{c\d+::/g) ?? []).length;
    expect(clozeTokens).toBe(1);
  });
});

describe('MCQ detection via DeckParser', () => {
  const fixtureDir = path.join(__dirname, '__fixtures__');

  function buildParserFromFixture(fixtureName: string) {
    const html = fs.readFileSync(path.join(fixtureDir, fixtureName)).toString();
    const workspace = new Workspace(true, 'fs');
    return new DeckParser({
      name: fixtureName,
      settings: new CardOption({ cherry: 'false', 'mcq-enabled': 'true' }),
      files: [{ name: fixtureName, contents: html }],
      noLimits: true,
      workspace,
    });
  }

  test('happy path: to-do checkbox produces MCQ note with correct shape', async () => {
    const parser = buildParserFromFixture('mcq-todo-checked.html');
    parser.customExporter.save = jest.fn().mockResolvedValue('');
    await parser.build(new Workspace(true, 'fs'));

    const deck = parser.payload[0];
    expect(deck.cards.length).toBe(1);
    const card = deck.cards[0];
    expect(card.mcq).toBe(true);
    expect(card.options.length).toBe(4);
    expect(card.correctIndices).toEqual([1]);
    expect(card.isValidMCQNote()).toBe(true);
    expect(deck.mcqCount).toBe(1);
    expect(deck.mcqSkippedCount).toBe(0);
  });

  test('happy path: fully-bolded bullet produces MCQ note via bold fallback', async () => {
    const parser = buildParserFromFixture('mcq-bold-fallback.html');
    parser.customExporter.save = jest.fn().mockResolvedValue('');
    await parser.build(new Workspace(true, 'fs'));

    const deck = parser.payload[0];
    expect(deck.cards.length).toBe(1);
    const card = deck.cards[0];
    expect(card.mcq).toBe(true);
    expect(card.options.length).toBe(4);
    expect(card.correctIndices).toEqual([1]);
    expect(card.isValidMCQNote()).toBe(true);
    expect(deck.mcqCount).toBe(1);
    expect(deck.mcqSkippedCount).toBe(0);
  });

  test('opt-in: mcq-enabled=false leaves an MCQ-shaped toggle as a Basic note', async () => {
    const html = fs
      .readFileSync(path.join(fixtureDir, 'mcq-todo-checked.html'))
      .toString();
    const workspace = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name: 'mcq-todo-checked.html',
      settings: new CardOption({ cherry: 'false' }),
      files: [{ name: 'mcq-todo-checked.html', contents: html }],
      noLimits: true,
      workspace,
    });
    parser.customExporter.save = jest.fn().mockResolvedValue('');
    await parser.build(new Workspace(true, 'fs'));

    const deck = parser.payload[0];
    expect(deck.cards.length).toBe(1);
    expect(deck.cards[0].mcq).toBe(false);
    expect(deck.mcqCount).toBe(0);
    expect(deck.mcqSkippedCount).toBe(0);
  });

  test('markdown: nested bulleted to-do produces MCQ note when mcq-enabled', async () => {
    const md = `# Using TODO\n\n- A 65-year-old man presents with crushing chest pain radiating to the jaw.\n    - [x]  Acute MI\n    - [ ]  Stable angina\n    - [ ]  GERD\n    - [ ]  Aortic dissection\n`;
    const workspace = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name: 'mcq.md',
      settings: new CardOption({ cherry: 'false', 'mcq-enabled': 'true' }),
      files: [{ name: 'mcq.md', contents: md }],
      noLimits: true,
      workspace,
    });
    parser.customExporter.save = jest.fn().mockResolvedValue('');
    await parser.build(new Workspace(true, 'fs'));

    const deck = parser.payload[0];
    expect(deck.cards.length).toBe(1);
    const card = deck.cards[0];
    expect(card.mcq).toBe(true);
    expect(card.options).toEqual([
      'Acute MI',
      'Stable angina',
      'GERD',
      'Aortic dissection',
    ]);
    expect(card.correctIndices).toEqual([0]);
    expect(deck.mcqCount).toBe(1);
    expect(deck.mcqSkippedCount).toBe(0);
    expect(card.back).toBe('');
  });

  test('real Notion export: fragmented ul.to-do-list under display:contents wrappers produces MCQ note', async () => {
    const parser = buildParserFromFixture('mcq-real-notion-export.html');
    parser.customExporter.save = jest.fn().mockResolvedValue('');
    await parser.build(new Workspace(true, 'fs'));

    const deck = parser.payload[0];
    expect(deck.cards.length).toBe(1);
    const card = deck.cards[0];
    expect(card.mcq).toBe(true);
    expect(card.options.length).toBe(4);
    expect(card.correctIndices).toEqual([0]);
    expect(card.isValidMCQNote()).toBe(true);
    expect(deck.mcqCount).toBe(1);
    expect(deck.mcqSkippedCount).toBe(0);
    expect(card.back).toBe('');
  });

  test('no marker: MCQ-shaped toggle with all unchecked to-dos falls back to Basic note', async () => {
    const parser = buildParserFromFixture('mcq-no-marker.html');
    parser.customExporter.save = jest.fn().mockResolvedValue('');
    await parser.build(new Workspace(true, 'fs'));

    const deck = parser.payload[0];
    expect(deck.cards.length).toBe(1);
    expect(deck.cards[0].mcq).toBe(false);
    expect(deck.mcqCount).toBe(0);
    expect(deck.mcqSkippedCount).toBe(1);
  });

  test('regression: existing non-MCQ fixture produces mcq=false on all cards', async () => {
    const fixtureHtml = fs
      .readFileSync(
        path.join(__dirname, '../../test/fixtures/Nested Toggles.html')
      )
      .toString();
    const workspace = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name: 'Nested Toggles.html',
      settings: new CardOption({
        cherry: 'true',
        reversed: 'true',
        'basic-reversed': 'true',
      }),
      files: [{ name: 'Nested Toggles.html', contents: fixtureHtml }],
      noLimits: true,
      workspace,
    });
    parser.customExporter.save = jest.fn().mockResolvedValue('');
    await parser.build(workspace);

    const deck = parser.payload[0];
    expect(deck.cards.length).toBeGreaterThan(0);
    expect(deck.mcqCount).toBe(0);
    for (const card of deck.cards) {
      expect(card.mcq).toBe(false);
    }
  });
});

test('name getter returns input name when payload is empty', () => {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'Foo.html',
    settings: new CardOption({ cherry: 'false' }),
    files: [],
    noLimits: false,
    workspace,
  });
  parser.payload = [];
  expect(parser.name).toBe('Foo.html');
});

describe('heuristic markdown path — entity preservation', () => {
  // Regression: markdown uploads with non-breaking spaces (U+00A0) were
  // rendered with the literal text "&nbsp;" in the card. Showdown converts
  // U+00A0 to the `&nbsp;` HTML entity, and `embedImagesInHtml` was running
  // the result through cheerio in `xmlMode: true`. xmlMode does not know
  // `&nbsp;` (it is not a valid XML entity) and re-escapes the `&` to
  // `&amp;`, producing `&amp;nbsp;` in the .apkg which Anki renders as the
  // visible text "&nbsp;". Locking in fragment mode so this can't regress.
  const nbsp = String.fromCharCode(0xa0);

  const buildHeuristicDeck = async (markdown: string) => {
    const workspace = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name: 'notes.md',
      settings: new CardOption({ cherry: 'false' }),
      files: [{ name: 'notes.md', contents: markdown }],
      noLimits: true,
      workspace,
    });
    parser.customExporter.save = jest.fn().mockResolvedValue('');
    await parser.build(workspace);
    return parser.payload[0];
  };

  it('does not double-escape &nbsp; into &amp;nbsp; in card backs', async () => {
    const markdown = [
      '## What is neonatal jaundice',
      `Jaundice is a${nbsp}**yellow discolouration of the sclerae and skin**${nbsp}due to excess bilirubin.`,
    ].join('\n');

    const deck = await buildHeuristicDeck(markdown);

    expect(deck.cards.length).toBeGreaterThan(0);
    const allHtml = deck.cards.map((c) => `${c.name}\n${c.back}`).join('\n');
    expect(allHtml).not.toContain('&amp;nbsp;');
    expect(allHtml).not.toContain('&amp;amp;');
  });

  it('preserves &nbsp; entity (or U+00A0) so Anki renders a non-breaking space', async () => {
    const markdown = ['## Concept', `prefix${nbsp}body content here`].join(
      '\n'
    );

    const deck = await buildHeuristicDeck(markdown);
    const back = deck.cards[0]?.back ?? '';
    const hasEntity = back.includes('&nbsp;');
    const hasChar = back.includes(nbsp);
    expect(hasEntity || hasChar).toBe(true);
  });
});

describe('embed-images opt-out', () => {
  const fixtureDir = path.join(__dirname, '__fixtures__/notion-html-2024');
  const html = fs.readFileSync(path.join(fixtureDir, 'index.html')).toString();
  const pngPath = path.join(
    fixtureDir,
    'notion-html-2024/pasted-screenshot.png'
  );
  const pngContents = fs.readFileSync(pngPath);

  function buildParser(settings: CardOption) {
    return new DeckParser({
      name: 'index.html',
      settings,
      files: [
        { name: 'index.html', contents: html },
        {
          name: 'notion-html-2024/pasted-screenshot.png',
          contents: pngContents,
        },
      ],
      noLimits: true,
      workspace: new Workspace(true, 'fs'),
    });
  }

  test('default (embed-images on) attaches image bytes to card media', async () => {
    const ws = new Workspace(true, 'fs');
    const parser = buildParser(
      new CardOption({ 'max-one-toggle-per-card': 'true', cherry: 'false' })
    );
    await parser.writeDeckInfo(ws);

    const cardWithMedia = parser.payload[0].cards.find(
      (c) => c.media.length > 0
    );
    expect(cardWithMedia).toBeDefined();
  });

  test('embed-images off leaves every card with an empty media list', async () => {
    const ws = new Workspace(true, 'fs');
    const parser = buildParser(
      new CardOption({
        'max-one-toggle-per-card': 'true',
        cherry: 'false',
        'embed-images': 'false',
      })
    );
    await parser.writeDeckInfo(ws);

    for (const card of parser.payload[0].cards) {
      expect(card.media).toHaveLength(0);
    }
  });

  const bulletMarkdown = [
    '# Notes',
    '',
    '- Question with image',
    '    ',
    '    ![diagram](diagram.png)',
    '    ',
  ].join('\n');

  test('embed-images off skips embed in markdown bullet path', async () => {
    const workspace = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name: 'notes.md',
      settings: new CardOption({
        cherry: 'false',
        'markdown-nested-bullet-points': 'true',
        'embed-images': 'false',
      }),
      files: [
        { name: 'notes.md', contents: bulletMarkdown },
        { name: 'diagram.png', contents: Buffer.from('fake-png-bytes') },
      ],
      noLimits: true,
      workspace,
    });
    await parser.writeDeckInfo(workspace);

    for (const card of parser.payload[0].cards) {
      expect(card.media).toHaveLength(0);
    }
  });

  test('embed-images on (default) embeds image in markdown bullet path', async () => {
    const workspace = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name: 'notes.md',
      settings: new CardOption({
        cherry: 'false',
        'markdown-nested-bullet-points': 'true',
      }),
      files: [
        { name: 'notes.md', contents: bulletMarkdown },
        { name: 'diagram.png', contents: Buffer.from('fake-png-bytes') },
      ],
      noLimits: true,
      workspace,
    });
    await parser.writeDeckInfo(workspace);

    const cardWithMedia = parser.payload[0].cards.find(
      (c) => c.media.length > 0
    );
    expect(cardWithMedia).toBeDefined();
  });
});

describe('remote image rehosting', () => {
  const signedUrl =
    'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/diagram.png?X-Amz-Expires=3600&X-Amz-Signature=abc';

  function buildRemoteImageParser(imageUrl: string = signedUrl) {
    const html = `<html><head><title>Deck</title></head><body><article>
<ul class="toggle"><li><details open="">
  <summary>Question</summary>
  <div><img src="${imageUrl}" /></div>
</details></li></ul>
</article></body></html>`;
    const workspace = new Workspace(true, 'fs');
    return new DeckParser({
      name: 'deck.html',
      settings: new CardOption({ cherry: 'false' }),
      files: [{ name: 'deck.html', contents: html }],
      noLimits: true,
      workspace,
    });
  }

  test('downloads a signed image not present in the export and rewrites the src to a local filename', async () => {
    const ws = new Workspace(true, 'fs');
    const parser = buildRemoteImageParser();
    await parser.writeDeckInfo(ws);

    expect(downloadMediaOrSkipMock).toHaveBeenCalledWith(signedUrl);
    const card = parser.payload[0].cards[0];
    expect(card.back).not.toContain('prod-files-secure.s3');
    const match = /src="([^"]+\.png)"/.exec(card.back);
    expect(match).not.toBeNull();
    const localName = match![1];
    expect(card.media).toContain(localName);
  });

  test('does not count a successfully embedded remote image as dropped', async () => {
    const ws = new Workspace(true, 'fs');
    const parser = buildRemoteImageParser();
    await parser.writeDeckInfo(ws);

    expect(parser.droppedImageCount).toBe(0);
  });

  test('keeps the original URL when the download fails so the card is never worse', async () => {
    downloadMediaOrSkipMock.mockResolvedValueOnce(null);
    const ws = new Workspace(true, 'fs');
    const parser = buildRemoteImageParser();
    await parser.writeDeckInfo(ws);

    const card = parser.payload[0].cards[0];
    expect(card.back).toContain(
      'prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/diagram.png'
    );
    expect(card.media).toHaveLength(0);
  });

  test('counts a remote image that could not be downloaded as dropped', async () => {
    downloadMediaOrSkipMock.mockResolvedValueOnce(null);
    const ws = new Workspace(true, 'fs');
    const parser = buildRemoteImageParser();
    await parser.writeDeckInfo(ws);

    expect(parser.droppedImageCount).toBe(1);
  });

  test('counts an expired Notion signed image separately when the fetch returns null', async () => {
    downloadMediaOrSkipMock.mockResolvedValueOnce(null);
    const ws = new Workspace(true, 'fs');
    const parser = buildRemoteImageParser();
    await parser.writeDeckInfo(ws);

    expect(parser.droppedImageCount).toBe(1);
    expect(parser.expiredNotionImageCount).toBe(1);
  });

  test('logs a skipped-media warning when a remote image fetch returns no content', async () => {
    downloadMediaOrSkipMock.mockResolvedValueOnce(null);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = new Workspace(true, 'fs');
    const parser = buildRemoteImageParser();
    await parser.writeDeckInfo(ws);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping media fetch')
    );
    warn.mockRestore();
  });

  test('does not count a plain external dropped image as an expired Notion image', async () => {
    downloadMediaOrSkipMock.mockResolvedValueOnce(null);
    const ws = new Workspace(true, 'fs');
    const parser = buildRemoteImageParser('https://example.com/photo.png');
    await parser.writeDeckInfo(ws);

    expect(parser.droppedImageCount).toBe(1);
    expect(parser.expiredNotionImageCount).toBe(0);
  });

  test('does not count a thrown fetch as an expired Notion image', async () => {
    downloadMediaOrSkipMock.mockRejectedValueOnce(
      new Error('[observability] invalid URL')
    );
    const ws = new Workspace(true, 'fs');
    const parser = buildRemoteImageParser();
    await parser.writeDeckInfo(ws);

    expect(parser.droppedImageCount).toBe(1);
    expect(parser.expiredNotionImageCount).toBe(0);
  });
});

describe('local and markdown images that cannot be resolved from the export', () => {
  test('counts a toggle-card local image missing from the export as dropped', async () => {
    const html = `<html><head><title>Deck</title></head><body><article>
<ul class="toggle"><li><details open="">
  <summary>What is the diagram?</summary>
  <div><img src="missing.png" /></div>
</details></li></ul>
</article></body></html>`;
    const ws = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name: 'Export-abc/deck.html',
      settings: new CardOption({ cherry: 'false' }),
      files: [{ name: 'Export-abc/deck.html', contents: html }],
      noLimits: true,
      workspace: ws,
    });

    await parser.writeDeckInfo(ws);

    const card = parser.payload[0].cards[0];
    expect(parser.droppedImageCount).toBe(1);
    expect(card.media).toHaveLength(0);
    expect(downloadMediaOrSkipMock).not.toHaveBeenCalled();
  });

  test('counts a markdown-heuristic local image missing from the export as dropped', async () => {
    const md = `## What is the diagram\n\nAnswer ![diagram](missing.png)\n`;
    const ws = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name: 'notes.md',
      settings: new CardOption({ cherry: 'false' }),
      files: [{ name: 'notes.md', contents: md }],
      noLimits: true,
      workspace: ws,
    });

    expect(parser.usedHeuristic).toBe(true);

    await parser.writeDeckInfo(ws);

    const deck = parser.payload[0];
    expect(parser.droppedImageCount).toBe(1);
    const allMedia = deck.cards.flatMap((c) => c.media);
    expect(allMedia).toHaveLength(0);
  });
});

describe('Notion export image with host glued to relative path', () => {
  function buildParser(imgSrc: string) {
    const html = `<html><head><title>Deck</title></head><body><article>
<ul class="toggle"><li><details open="">
  <summary>What is the management?</summary>
  <div><img src="${imgSrc}" /></div>
</details></li></ul>
</article></body></html>`;
    const workspace = new Workspace(true, 'fs');
    return new DeckParser({
      name: 'Export-abc/deck.html',
      settings: new CardOption({ cherry: 'false' }),
      files: [
        { name: 'Export-abc/deck.html', contents: html },
        {
          name: 'Export-abc/Obstetrics 1/image 1.png',
          contents: Buffer.from('fake-png-bytes'),
        },
      ],
      noLimits: true,
      workspace,
    });
  }

  test('embeds the subfolder image from the zip instead of dropping it', async () => {
    // In prod the malformed URL throws an invalid-URL error in the SSRF guard,
    // so the remote fetch can never rescue the image. Mirror that here so the
    // image can only survive via the zip-recovery path.
    downloadMediaOrSkipMock.mockRejectedValue(
      new Error('[observability] invalid URL')
    );
    const ws = new Workspace(true, 'fs');
    // Notion's export glues the host onto the relative subfolder path with no
    // slash, producing an invalid URL that cannot be fetched.
    const parser = buildParser(
      'https://app.notion.comObstetrics%201/image%201.png'
    );

    await parser.writeDeckInfo(ws);

    const card = parser.payload[0].cards[0];
    expect(card.back).not.toContain('app.notion.com');
    expect(card.media).toHaveLength(1);
    const match = /src="([^"]+\.png)"/.exec(card.back);
    expect(match).not.toBeNull();
    expect(card.media).toContain(match![1]);
  });

  test('never tries to fetch the malformed URL over the network', async () => {
    const ws = new Workspace(true, 'fs');
    const parser = buildParser(
      'https://app.notion.comObstetrics%201/image%201.png'
    );

    await expect(parser.writeDeckInfo(ws)).resolves.not.toThrow();
    expect(downloadMediaOrSkipMock).not.toHaveBeenCalled();
  });
});

describe('card audio embedding', () => {
  function audioParser(
    bodyHtml: string,
    extraFiles: { name: string; contents: Buffer }[]
  ) {
    const html = `<html><head><title>Audio Deck</title></head><body><article>
<ul class="toggle"><li><details open="">
  <summary>Hear it</summary>
  <div>${bodyHtml}</div>
</details></li></ul>
</article></body></html>`;
    return new DeckParser({
      name: 'deck.html',
      settings: new CardOption({ cherry: 'false' }),
      files: [{ name: 'deck.html', contents: html }, ...extraFiles],
      noLimits: true,
      workspace: new Workspace(true, 'fs'),
    });
  }

  test('embeds a non-mp3 audio link and appends a sound tag', async () => {
    const parser = audioParser(
      '<figure><div class="source"><a href="Audio%20Deck/recording.m4a">recording.m4a</a></div></figure>',
      [{ name: 'Audio Deck/recording.m4a', contents: Buffer.from('fake-m4a') }]
    );
    const ws = new Workspace(true, 'fs');

    await parser.writeDeckInfo(ws);
    const card = parser.payload[0].cards[0];

    expect(card.back).toMatch(/\[sound:[^\]]+\.m4a\]/);
    expect(card.media.some((m) => m.endsWith('.m4a'))).toBe(true);
  });

  test('embeds every audio link on the card, not only the first', async () => {
    const parser = audioParser(
      '<figure><div class="source"><a href="Audio%20Deck/first.mp3">first.mp3</a></div></figure>' +
        '<figure><div class="source"><a href="Audio%20Deck/second.wav">second.wav</a></div></figure>',
      [
        { name: 'Audio Deck/first.mp3', contents: Buffer.from('fake-mp3') },
        { name: 'Audio Deck/second.wav', contents: Buffer.from('fake-wav') },
      ]
    );
    const ws = new Workspace(true, 'fs');

    await parser.writeDeckInfo(ws);
    const card = parser.payload[0].cards[0];

    expect(card.back).toMatch(/\[sound:[^\]]+\.mp3\]/);
    expect(card.back).toMatch(/\[sound:[^\]]+\.wav\]/);
    expect(card.media).toHaveLength(2);
  });

  test('embeds an html5 audio element and removes the dead player', async () => {
    const parser = audioParser(
      '<audio controls="" src="Audio%20Deck/note.ogg"></audio>',
      [{ name: 'Audio Deck/note.ogg', contents: Buffer.from('fake-ogg') }]
    );
    const ws = new Workspace(true, 'fs');

    await parser.writeDeckInfo(ws);
    const card = parser.payload[0].cards[0];

    expect(card.back).toMatch(/\[sound:[^\]]+\.ogg\]/);
    expect(card.back).not.toContain('<audio');
  });

  test('leaves remote audio URLs alone', async () => {
    const parser = audioParser(
      '<a href="https://example.com/episode.mp3">episode</a>',
      []
    );
    const ws = new Workspace(true, 'fs');

    await parser.writeDeckInfo(ws);
    const card = parser.payload[0].cards[0];

    expect(card.back).not.toContain('[sound:');
    expect(card.media).toHaveLength(0);
  });
});
