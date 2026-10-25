import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';
import { SPLIT_HTML_ABOVE_BYTES } from './splitLargeHtml';

beforeEach(() => setupTests());

function toggle(n: number): string {
  return `<ul class="toggle"><li><details><summary>Question ${n}</summary><p>Answer ${n}</p></details></li></ul>`;
}

function pageWith(count: number, padding: number): string {
  const filler = `<p>${'lorem ipsum dolor sit amet '.repeat(padding)}</p>`;
  const children = Array.from({ length: count }, (_, i) => toggle(i)).join(
    filler
  );
  return `<!DOCTYPE html><html><head><title>Large page</title></head><body><article class="page sans"><header><h1 class="page-title">Large page</h1></header><div class="page-body">${children}</div></article></body></html>`;
}

function parse(html: string): DeckParser {
  return new DeckParser({
    name: 'large.html',
    settings: new CardOption({ cherry: 'false' }),
    files: [{ name: 'large.html', contents: html }],
    noLimits: true,
    workspace: new Workspace(true, 'fs'),
  });
}

describe('DeckParser on a page above the split size', () => {
  const cardCount = 40;
  const padding = Math.ceil(SPLIT_HTML_ABOVE_BYTES / (cardCount - 1) / 27) + 10;
  const html = pageWith(cardCount, padding);

  it('is large enough to be parsed in parts', () => {
    expect(html.length).toBeGreaterThan(SPLIT_HTML_ABOVE_BYTES);
  });

  it('makes one deck holding every card, in order', () => {
    const parser = parse(html);

    expect(parser.payload).toHaveLength(1);
    expect(parser.payload[0].name).toBe('Large page');
    const fronts = parser.payload[0].cards.map((card) => card.name);
    expect(fronts).toHaveLength(cardCount);
    expect(fronts[0]).toContain('Question 0');
    expect(fronts[cardCount - 1]).toContain(`Question ${cardCount - 1}`);
  });

  it('gives the same cards as the same page parsed whole', () => {
    const whole = parse(pageWith(cardCount, 2)).payload[0].cards.map(
      (card) => card.name
    );
    const parts = parse(html).payload[0].cards.map((card) => card.name);

    expect(parts).toEqual(whole);
  });
});

describe(
  'DeckParser on a large page whose slices differ',
  { timeout: 60_000 },
  () => {
    const prose = `<p>${'a plain sentence of prose. '.repeat(40)}</p>`;

    function mixed(proseBlocks: number, withToggles: boolean): string {
      const toggles = withToggles
        ? Array.from({ length: 6 }, (_, i) => toggle(i)).join('')
        : '';
      return `<!DOCTYPE html><html><head><title>Mixed</title></head><body><article class="page sans"><header><h1 class="page-title">Mixed</h1></header><div class="page-body">${prose.repeat(proseBlocks)}${toggles}${prose.repeat(proseBlocks)}</div></article></body></html>`;
    }

    const bigBlocks = Math.ceil(SPLIT_HTML_ABOVE_BYTES / prose.length / 2) + 10;

    function backs(parser: DeckParser): string[] {
      return parser.payload[0].cards.map((card) => `${card.name}|${card.back}`);
    }

    it('does not turn prose slices into cards when toggles exist elsewhere', () => {
      const split = parse(mixed(bigBlocks, true));
      const whole = parse(mixed(3, true));

      expect(backs(split)).toEqual(backs(whole));
    });

    it('keeps going on a prose only page without repeating cards', () => {
      const cards = parse(mixed(bigBlocks * 2, false)).payload[0].cards;
      const keys = cards.map((card) => `${card.name}|${card.back}`);

      expect(new Set(keys).size).toBe(keys.length);
    });
  }
);
