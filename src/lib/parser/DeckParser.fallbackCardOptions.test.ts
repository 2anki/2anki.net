import { vi } from 'vitest';

import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

// The real exporter shells out to the Python venv; these tests only need the
// payload tryExperimental hands it.
vi.mock('./exporters/CustomExporter', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return {
      configure: vi.fn(),
      save: vi.fn().mockResolvedValue(Buffer.from('fake-apkg')),
    };
  }),
}));

beforeEach(() => setupTests());

const csv = [
  'front,back',
  '会う,あう — to meet (verb)',
  '青い,あおい — blue (adjective)',
].join('\n');

// CSV, TSV and anything the structured parser finds no cards in take the
// plain-text fallback, which builds through tryExperimental.
async function fallbackCards(
  name: string,
  contents: string,
  settings: Record<string, string>
) {
  const parser = new DeckParser({
    name,
    settings: new CardOption(settings),
    files: [{ name, contents: Buffer.from(contents) }],
    noLimits: true,
    workspace: new Workspace(true, 'fs'),
  });
  await parser.tryExperimental();
  return parser.payload.flatMap((deck) => deck.cards);
}

describe('DeckParser.tryExperimental card options', () => {
  it('leaves out the mirrored note whose front would be an empty answer', async () => {
    const cards = await fallbackCards(
      'blank-answer.csv',
      'front,back\nQuestion one,Answer one\nQuestion two,<p></p>',
      { 'basic-reversed': 'true', cloze: 'false' }
    );

    expect(cards.map((card) => card.name)).toEqual([
      'Question one',
      'Question two',
      'Answer one',
    ]);
  });

  it('adds a mirrored note for every CSV row when basic-reversed is on', async () => {
    const cards = await fallbackCards('reversed-test.csv', csv, {
      'basic-reversed': 'true',
      cloze: 'false',
    });

    expect(cards.map((card) => [card.name, card.back])).toEqual([
      ['会う', 'あう — to meet (verb)'],
      ['青い', 'あおい — blue (adjective)'],
      ['あう — to meet (verb)', '会う'],
      ['あおい — blue (adjective)', '青い'],
    ]);
  });

  it('keeps one note per CSV row when basic-reversed is off', async () => {
    const cards = await fallbackCards('reversed-test.csv', csv, {
      cloze: 'false',
    });

    expect(cards).toHaveLength(2);
  });

  it('skips the mirrored note for a row with an empty back', async () => {
    const cards = await fallbackCards(
      'reversed-test.csv',
      'front,back\n会う,あう\n青い,\n',
      { 'basic-reversed': 'true', cloze: 'false' }
    );

    expect(cards.map((card) => [card.name, card.back])).toEqual([
      ['会う', 'あう'],
      ['青い', ''],
      ['あう', '会う'],
    ]);
  });

  it('swaps the sides of every CSV row when reversed is on', async () => {
    const cards = await fallbackCards('reversed-test.csv', csv, {
      reversed: 'true',
      cloze: 'false',
    });

    expect(cards.map((card) => [card.name, card.back])).toEqual([
      ['あう — to meet (verb)', '会う'],
      ['あおい — blue (adjective)', '青い'],
    ]);
  });

  it('applies global tags to every CSV note, mirrored ones included', async () => {
    const cards = await fallbackCards('reversed-test.csv', csv, {
      'basic-reversed': 'true',
      'global-tags': 'japanese,n5',
      cloze: 'false',
    });

    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.tags).toEqual(['japanese', 'n5']);
    }
  });

  it('honours basic-reversed on a plain-text fallback upload too', async () => {
    const cards = await fallbackCards(
      'notes.txt',
      'Capital of France - Paris\n\nLargest planet - Jupiter',
      { 'basic-reversed': 'true', cloze: 'false' }
    );

    expect(cards.length).toBeGreaterThan(0);
    const forward = cards.filter((card) => card.name.includes('France'));
    const mirrored = cards.filter((card) => card.back.includes('France'));
    expect(forward).toHaveLength(1);
    expect(mirrored).toHaveLength(1);
  });
});
