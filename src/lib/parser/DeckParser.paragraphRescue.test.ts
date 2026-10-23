import { DeckParser } from './DeckParser';
import Deck from './Deck';
import CardOption from './Settings';
import Workspace from './WorkSpace';
import { setupTests } from '../../test/configure-jest';

beforeEach(() => setupTests());

function page(inner: string): string {
  return `<html><head><title>Notes</title></head><body><article class="page sans"><header><h1 class="page-title">Notes</h1></header><div class="page-body">${inner}</div></article></body></html>`;
}

function parse(html: string, settings: CardOption): DeckParser {
  return new DeckParser({
    name: 'notes.html',
    settings,
    files: [{ name: 'notes.html', contents: html }],
    noLimits: true,
    workspace: new Workspace(true, 'fs'),
  });
}

const PROSE =
  '<p>The <strong>mitochondrion</strong> produces most of the energy a cell uses.</p>' +
  '<p>A <mark>ribosome</mark> builds proteins by reading messenger RNA in the cytoplasm.</p>' +
  '<p>Water crosses a membrane by osmosis, moving toward the higher solute concentration.</p>' +
  '<p>Short note.</p>';

describe('paragraph cards for a page with nothing else to build from', () => {
  it('offers the paragraphs with their count and ships nothing on its own', () => {
    const parser = parse(page(PROSE), new CardOption({ cherry: 'false' }));

    expect(Deck.CleanCards([...parser.payload[0].cards])).toHaveLength(0);
    expect(parser.rescueCandidates).toContainEqual({
      rule: 'paragraphs',
      cards: 3,
    });
    expect(parser.inducedRule).toBeUndefined();
  });

  it('builds one card per paragraph once the person picks them', () => {
    const parser = parse(
      page(PROSE),
      new CardOption({ cherry: 'false', 'rescue-rule': 'paragraphs' })
    );

    const cards = parser.payload[0].cards;
    expect(cards.map((card) => card.name)).toEqual([
      'mitochondrion',
      'ribosome',
      'Water crosses a membrane by osmosis, moving toward the higher solute concentration.',
    ]);
    expect(cards[0].back).toContain('produces most of the energy');
    expect(parser.inducedRule).toMatchObject({
      rule: 'paragraphs',
      outcome: 'rescue_chosen',
    });
  });

  it('does not offer paragraphs when there are too few to be a deck', () => {
    const parser = parse(
      page(PROSE.split('</p>').slice(0, 2).join('</p>') + '</p>'),
      new CardOption({ cherry: 'false' })
    );

    expect(parser.rescueCandidates).toEqual([]);
  });
});
