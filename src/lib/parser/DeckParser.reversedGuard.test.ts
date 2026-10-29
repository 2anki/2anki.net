import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Deck from './Deck';
import Note from './Note';
import Workspace from './WorkSpace';

const SIMPLE_HTML = `<html><head><title>Seed</title></head>
<body><article class="page sans"><header><h1 class="page-title">Seed</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>Q</summary><p>A</p></details></li></ul>
</div></article></body></html>`;

function seedParser(settings: CardOption, cards: Note[]): DeckParser {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'seed.html',
    settings,
    files: [{ name: 'seed.html', contents: SIMPLE_HTML }],
    noLimits: true,
    workspace,
  });
  const deck = new Deck('Seed', cards, undefined, null, 0, settings);
  parser.payload = [deck];
  return parser;
}

describe('processPayload reversal guard', () => {
  let workspace: Workspace;

  beforeAll(() => {
    process.env.SKIP_CREATE_DECK = '1';
  });

  afterAll(() => {
    delete process.env.SKIP_CREATE_DECK;
  });

  beforeEach(() => {
    setupTests();
    workspace = new Workspace(true, 'fs');
  });

  test('basic-reversed does not generate a companion card from a cloze note', async () => {
    const settings = new CardOption({
      cherry: 'false',
      'basic-reversed': 'true',
    });
    const cloze = new Note(
      'Mitochondria is the {{c1::powerhouse}} of the cell',
      'Cell biology'
    );
    cloze.cloze = true;
    const parser = seedParser(settings, [cloze]);

    await parser.build(workspace);

    const cards = parser.payload[0].cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].cloze).toBe(true);
    expect(cards.some((card) => !card.cloze && card.back.includes('{{c'))).toBe(
      false
    );
  });

  test('basic-reversed still generates a companion card for a plain note', async () => {
    const settings = new CardOption({
      cherry: 'false',
      cloze: 'false',
      'basic-reversed': 'true',
    });
    const basic = new Note('Front side', 'Back side');
    const parser = seedParser(settings, [basic]);

    await parser.build(workspace);

    const cards = parser.payload[0].cards;
    expect(cards).toHaveLength(2);
    expect(
      cards.some(
        (card) => card.name === 'Back side' && card.back === 'Front side'
      )
    ).toBe(true);
  });

  test('deck-wide reversed swaps the sides of a plain note in place', async () => {
    const settings = new CardOption({
      cherry: 'false',
      cloze: 'false',
      reversed: 'true',
    });
    const parser = seedParser(settings, [new Note('Front side', 'Back side')]);

    await parser.build(workspace);

    const cards = parser.payload[0].cards;
    expect(cards.map((card) => [card.name, card.back])).toEqual([
      ['Back side', 'Front side'],
    ]);
    expect(cards[0].frontEscaped).toBeUndefined();
    expect(cards[0].backEscaped).toBeUndefined();
  });

  test('deck-wide reversed keeps an mcq note in the deck', async () => {
    const settings = new CardOption({
      cherry: 'false',
      reversed: 'true',
    });
    const mcq = new Note('Which is a noble gas?', '');
    mcq.mcq = true;
    mcq.options = ['Helium', 'Oxygen'];
    mcq.correctIndices = [0];
    const parser = seedParser(settings, [mcq]);

    await parser.build(workspace);

    const cards = parser.payload[0].cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].mcq).toBe(true);
    expect(cards[0].name).toBe('Which is a noble gas?');
    expect(cards[0].isValidMCQNote()).toBe(true);
  });
});
