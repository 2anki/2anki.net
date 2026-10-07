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

async function convert(file: string, opts = new CardOption({})) {
  const workspace = new Workspace(true, 'fs');
  const contents = fs
    .readFileSync(path.join(__dirname, '../../../test/fixtures', file))
    .toString();
  const parser = new DeckParser({
    name: file,
    settings: opts,
    files: [{ name: file, contents }],
    noLimits: true,
    workspace,
  });
  await parser.build(workspace);
  return snapshotShape(parser.payload);
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
];

it.each(cases)('produces a stable deck for %s', async (_label, file, opts) => {
  const shape = await convert(file, opts);
  expect(shape).toMatchSnapshot();
});
