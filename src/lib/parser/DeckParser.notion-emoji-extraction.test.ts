import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

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

test('extracts emoji from data-emoji attribute in Notion 2026 export', async () => {
  const html = `<html><head><title>Multi Page Support</title><meta name="data-notion-page-icon" content="🌇"/></head>
<body><article class="page sans" data-notion-page-icon="🌇"><header>
<div class="page-header-icon page-header-icon-with-cover">
  <span class="icon" data-emoji="🌇"></span>
</div>
<h1 class="page-title" dir="auto">Multi Page Support</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Test card</summary>
<p>Card answer.</p></details></li></ul>
</div></article></body></html>`;

  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'test.html',
    settings: new CardOption({ cherry: 'false' }),
    files: [{ name: 'test.html', contents: html }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);

  const deckName = parser.payload[0].name;
  expect(deckName).toBe('🌇 Multi Page Support');
});

const parentWithLinkedChild = (
  iconSpan: string
) => `<html><head><title>Parent</title></head>
<body><article class="page sans"><header>
<div class="page-header-icon"><span class="icon" data-emoji="📖"></span></div>
<h1 class="page-title">Parent</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Parent card</summary><p>Parent answer.</p></details></li></ul>
<figure id="1" class="link-to-page"><a href="Child%20Page.html">${iconSpan}Child Page</a></figure>
</div></article></body></html>`;

const childPage = `<html><head><title>Child Page</title></head>
<body><article class="page sans"><header><h1 class="page-title">Child Page</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Child card</summary><p>Child answer.</p></details></li></ul>
</div></article></body></html>`;

async function subDeckNames(parentHtml: string, settings = {}) {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'parent.html',
    settings: new CardOption({ cherry: 'false', ...settings }),
    files: [
      { name: 'parent.html', contents: parentHtml },
      { name: 'Child Page.html', contents: childPage },
    ],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);
  return parser.payload.map((deck) => deck.name);
}

test.each([
  [
    'the 2026 data-emoji icon with empty text',
    '<span class="icon" data-emoji="💼"></span>',
  ],
  [
    'the older export that carries the emoji as icon text',
    '<span class="icon">💼</span>',
  ],
  [
    'an icon that carries the emoji as both attribute and text',
    '<span class="icon" data-emoji="💼">💼</span>',
  ],
])(
  'names the nested deck with a single sub-page emoji from %s',
  async (_, iconSpan) => {
    const names = await subDeckNames(parentWithLinkedChild(iconSpan));
    expect(names).toEqual(['📖 Parent', '📖 Parent::💼Child Page']);
  }
);

test('leaves the sub-page emoji out when page-emoji is disabled', async () => {
  const names = await subDeckNames(
    parentWithLinkedChild('<span class="icon" data-emoji="💼"></span>'),
    { 'page-emoji': 'disable_emoji' }
  );
  expect(names).toEqual(['Parent', 'Parent::Child Page']);
});

test('appends the sub-page emoji with a space when page-emoji is last_emoji', async () => {
  const names = await subDeckNames(
    parentWithLinkedChild('<span class="icon" data-emoji="💼"></span>'),
    { 'page-emoji': 'last_emoji' }
  );
  expect(names).toEqual(['Parent 📖', 'Parent 📖::Child Page 💼']);
});
