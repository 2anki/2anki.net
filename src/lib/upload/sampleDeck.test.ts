import { setupTests } from '../../test/configure-jest';
import CardOption from '../parser/Settings/CardOption';
import { DeckParser } from '../parser/DeckParser';
import Workspace from '../parser/WorkSpace';
import {
  SAMPLE_DECK_FILENAME,
  SAMPLE_DECK_HTML,
  SAMPLE_DECK_NAME,
} from './sampleDeck';

beforeEach(() => setupTests());

describe('bundled sample deck', () => {
  it('parses to a small Q/A deck of at most 8 cards with the standard parser', () => {
    const parser = new DeckParser({
      name: SAMPLE_DECK_FILENAME,
      settings: new CardOption({}),
      files: [{ name: SAMPLE_DECK_FILENAME, contents: SAMPLE_DECK_HTML }],
      noLimits: true,
      workspace: new Workspace(true, 'fs'),
    });

    const cardCount = parser.totalCardCount();
    expect(cardCount).toBe(8);
    expect(cardCount).toBeLessThanOrEqual(8);
  });

  it('names the deck from the page title', () => {
    const parser = new DeckParser({
      name: SAMPLE_DECK_FILENAME,
      settings: new CardOption({}),
      files: [{ name: SAMPLE_DECK_FILENAME, contents: SAMPLE_DECK_HTML }],
      noLimits: true,
      workspace: new Workspace(true, 'fs'),
    });

    expect(parser.payload[0].name).toContain(SAMPLE_DECK_NAME);
  });

  it('keeps each question paired with its answer', () => {
    const parser = new DeckParser({
      name: SAMPLE_DECK_FILENAME,
      settings: new CardOption({}),
      files: [{ name: SAMPLE_DECK_FILENAME, contents: SAMPLE_DECK_HTML }],
      noLimits: true,
      workspace: new Workspace(true, 'fs'),
    });

    const cards = parser.payload.flatMap((deck) => deck.cards);
    const mitochondrion = cards.find((card) =>
      card.name.includes('powerhouse of the cell')
    );
    expect(mitochondrion?.back).toContain('mitochondrion');
  });
});
