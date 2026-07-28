import { DeckParser } from './DeckParser';
import CardOption from './Settings';
import Workspace from './WorkSpace';
import Deck from './Deck';
import { setupTests } from '../../test/configure-jest';

beforeEach(() => setupTests());

// Exercises the upload-path empty-deck rescue through the constructor, which
// runs processFirstFile -> handleHTML without spawning Python (no build()), so
// these run in a worktree that has no create_deck venv.

const HEADING_SECTIONS = `
  <h2>What is osmosis?</h2><p>Water crossing a membrane.</p>
  <h2>What is diffusion?</h2><p>Particles spreading out over time.</p>
  <h2>What is mitosis?</h2><p>Cell division into two identical cells.</p>
`;

// A toggle with a summary but no body renders one card with an empty back —
// the exact "present but unusable" shape Deck.CleanCards later strips.
const EMPTY_TOGGLE =
  '<ul class="toggle"><li><details open=""><summary>An empty toggle</summary></details></li></ul>';

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

describe('DeckParser upload rescue gating', () => {
  it('rescues when the parse produced only cards CleanCards would strip', () => {
    const parser = parse(
      page(`${EMPTY_TOGGLE}${HEADING_SECTIONS}`),
      new CardOption({ cherry: 'false' })
    );

    const cards = parser.payload[0].cards;
    expect(Deck.CleanCards(cards).length).toBeGreaterThanOrEqual(3);
    const fronts = cards.map((card) => card.name).join(' ');
    expect(fronts).toContain('osmosis');
    expect(parser.inducedRule).toMatchObject({
      rule: 'heading',
      outcome: 'rescue_shipped',
    });
  });

  it('does not induce when the parse already produced usable cards', () => {
    const usableToggle =
      '<ul class="toggle"><li><details open=""><summary>What is a cell?</summary><div class="indented">The basic unit of life.</div></details></li></ul>';
    const parser = parse(
      page(`${usableToggle}${HEADING_SECTIONS}`),
      new CardOption({ cherry: 'false' })
    );

    expect(parser.inducedRule).toBeUndefined();
  });

  it('skips induction when the conversion is cherry-restricted', () => {
    const parser = parse(
      page(`${EMPTY_TOGGLE}${HEADING_SECTIONS}`),
      new CardOption({ cherry: 'true' })
    );

    expect(parser.inducedRule).toBeUndefined();
    const fronts = parser.payload[0].cards.map((card) => card.name).join(' ');
    expect(fronts).not.toContain('osmosis');
  });
});
