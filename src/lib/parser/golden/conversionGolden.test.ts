import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';

import { setupTests } from '../../../test/configure-jest';
import CardOption from '../Settings';
import Deck from '../Deck';
import { DeckParser } from '../DeckParser';
import Workspace from '../WorkSpace';

/**
 * Behaviour-harness golden test for the .apkg conversion path.
 *
 * Real users hand us a file and expect a correct deck back. Unit tests cover
 * individual parser branches, but nothing locks the *whole* shape of a produced
 * deck — the regressions that break real decks (wrong field in front/back per
 * #3119, a dropped media reference, a cloze that stopped being a cloze) are
 * invisible to a green unit suite. This snapshots the stable shape of the deck
 * model that CustomExporter serializes to deck_info.json — exactly the payload
 * the Python packager reads. card.media is asserted because create_deck.py only
 * bundles a file that appears on some card's media array (see
 * src/lib/ankify/FEATURE.md), so a dropped reference here means a broken deck.
 *
 * No Python venv: we read parser.payload directly, so this runs in plain Jest
 * and in CI. Remote media is mocked with fixed bytes, so media filenames (a
 * hash of the bytes) are deterministic.
 *
 * Regenerate intentionally after a real deck-output change:
 *   pnpm test -- src/lib/parser/golden/conversionGolden.test.ts -u
 * Review the snapshot diff like code — an unexpected change is a regression.
 */

const downloadMediaOrSkipMock = vi.hoisted(() =>
  vi.fn<(url: string) => Promise<Buffer | null>>()
);

vi.mock('../../../services/NotionService/helpers/downloadMediaOrSkip', () => ({
  __esModule: true,
  downloadMediaOrSkip: (url: string) => downloadMediaOrSkipMock(url),
}));

beforeEach(() => {
  setupTests();
  downloadMediaOrSkipMock.mockReset();
  downloadMediaOrSkipMock.mockResolvedValue(
    Buffer.from('golden-fixture-bytes')
  );
});

function cardType(card: Deck['cards'][number]): string {
  if (card.cloze) return 'cloze';
  if (card.mcq) return 'mcq';
  if (card.enableInput) return 'input';
  return 'basic';
}

function snapshotShape(payload: Deck[]) {
  return payload.map((deck) => ({
    name: deck.name,
    cardCount: deck.cards.length,
    globalTags: deck.globalTags,
    styleBytes: (deck.style ?? '').length,
    cards: deck.cards.map((card) => ({
      type: cardType(card),
      ...(card.customModelName ? { modelName: card.customModelName } : {}),
      front: card.name,
      back: card.back,
      tags: card.tags,
      media: card.media,
    })),
  }));
}

function readFixture(file: string): string {
  return fs
    .readFileSync(path.join(__dirname, '../../../test/fixtures', file))
    .toString();
}

async function convertExport(
  files: { name: string; contents: string }[],
  opts: CardOption
) {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: files[0].name,
    settings: opts,
    files,
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);
  return snapshotShape(parser.payload);
}

function convert(file: string, opts = new CardOption({})) {
  return convertExport([{ name: file, contents: readFixture(file) }], opts);
}

const cases: [string, string, CardOption][] = [
  [
    'Notion cloze export',
    'Grouped Cloze Deletions fbf856ad7911423dbef0bfd3e3c5ce5c 3.html',
    new CardOption({}),
  ],
  ['Notion nested toggles', 'Nested Toggles.html', new CardOption({})],
  ['Notion page with an image', 'with-image.html', new CardOption({})],
  [
    'Notion page with a remote image',
    'golden-remote-image.html',
    new CardOption({}),
  ],
  [
    'Markdown upload',
    'simple-deck.md',
    new CardOption({ 'markdown-nested-bullet-points': 'true' }),
  ],
  [
    'Notion page with coloured text',
    'Colours 0519bf7e86d84ee4ba710c1b7ff7438e.html',
    new CardOption({}),
  ],
  [
    'Notion page with default settings',
    'Default 8e8a3abeb8d14f6a9fc3cb0d6c086ecb.html',
    new CardOption({}),
  ],
  [
    'Notion page with global tags',
    'Global Tag Support.html',
    new CardOption({ tags: 'true', cherry: 'false' }),
  ],
  [
    'Notion page with file-level tags',
    'multi-file-tags-a.html',
    new CardOption({ tags: 'true', cherry: 'false' }),
  ],
  ['Notion nested toggle', 'nested-toggle-test.html', new CardOption({})],
  ['Notion page without images', 'no-images.html', new CardOption({})],
  [
    'Notion page with grandchildren',
    'Notion Page grandchildren 2ce7ab29a11e809998e3d22ed65fc5f2.html',
    new CardOption({}),
  ],
  ['Notion figure image', 'notion-figure-image.html', new CardOption({})],
  [
    'Notion fragmented numbered list',
    'notion-fragmented-numbered-list.html',
    new CardOption({}),
  ],
  ['Notion mixed lines', 'notion-mixed-lines.html', new CardOption({})],
  [
    'Notion multi-paragraph toggle',
    'notion-multi-paragraph.html',
    new CardOption({}),
  ],
  [
    'Markdown nested bullets',
    'notion-nested-bullets.md',
    new CardOption({ 'markdown-nested-bullet-points': 'true' }),
  ],
  [
    'Notion new export with bullets in a toggle',
    'notion-new-export-bullets-in-toggle.html',
    new CardOption({}),
  ],
  [
    'Notion new export, nested',
    'notion-new-export-nested.html',
    new CardOption({}),
  ],
  ['Notion poem lines', 'notion-poem-lines.html', new CardOption({})],
  ['Notion prose lines', 'notion-prose-lines.html', new CardOption({})],
  [
    'Notion real numbered list',
    'notion-real-numbered-list.html',
    new CardOption({}),
  ],
  [
    'Notion single-paragraph toggle',
    'notion-single-paragraph.html',
    new CardOption({}),
  ],
  [
    'Notion page with parent context on',
    'parent-context.html',
    new CardOption({ 'parent-context': 'true' }),
  ],
  [
    'Notion toggle with a struck-through basic marker',
    'partial-basic-toggle.html',
    new CardOption({}),
  ],
  [
    'Notion toggle with an emoji',
    'refresh-emoji-toggle.html',
    new CardOption({}),
  ],
  [
    'Notion page with section tags in cherry mode',
    'section-tags.html',
    new CardOption({ cherry: 'true', 'section-tags': 'true' }),
  ],
  [
    'Notion page with some cloze deletions',
    'Some Cloze Deletions 1a118169ada841a99a9aaccc7eaa6775.html',
    new CardOption({}),
  ],
  ['Notion toggle headings', 'Toggle Hea 0e02b 2.html', new CardOption({})],
  [
    'Notion toggle heading with toggles',
    'toggle-heading-with-toggles-synthetic.html',
    new CardOption({}),
  ],
  [
    'Notion toggle with bullets and a nested toggle',
    'toggle-with-bullets-and-nested-toggle.html',
    new CardOption({}),
  ],
  [
    'Notion toggle with bullets',
    'toggle-with-bullets.html',
    new CardOption({}),
  ],
  [
    'Notion toggle with spacing',
    'toggle-with-spacing.html',
    new CardOption({}),
  ],
  [
    'Notion toggles test page',
    'Toggles test 2cd7ab29a11e80bea100ed002a880884.html',
    new CardOption({}),
  ],
  [
    'Markdown upload with images',
    'with-images.md',
    new CardOption({ 'markdown-nested-bullet-points': 'true' }),
  ],
];

it.each(cases)('produces a stable deck for %s', async (_label, file, opts) => {
  const shape = await convert(file, opts);
  expect(shape).toMatchSnapshot();
});

it('produces a stable deck for a Notion parent page that links a subpage', async () => {
  const shape = await convertExport(
    [
      {
        name: 'Solar System 3727ab29a11e805099c5efe852c0ce3c.html',
        contents: readFixture('notion-real-parent-with-link.html'),
      },
      {
        name: 'Solar System/Planets 3727ab29a11e807bbf51f5be7dc2959a.html',
        contents: readFixture('notion-real-numbered-list.html'),
      },
    ],
    new CardOption({})
  );
  expect(shape).toMatchSnapshot();
});
