import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

const wrap = (title: string) =>
  `<html><head><title>${title}</title></head><body><article class="page sans"><header><h1 class="page-title">${title}</h1></header><div class="page-body"><ul class="toggle"><li><details open=""><summary>What is the powerhouse of the cell?</summary><div class="indented"><p>The mitochondria</p></div></details></li></ul></div></article></body></html>`;

function deckNameFor(html: string, options: Record<string, string>): string {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'page.html',
    settings: new CardOption(options),
    files: [{ name: 'page.html', contents: html }],
    noLimits: true,
    workspace,
  });
  return parser.payload[0].name;
}

describe('deck name numbering option', () => {
  it('strips leading numbering from a derived title when the option is on', () => {
    const name = deckNameFor(wrap('3. Cell Biology'), {
      'remove-deck-name-numbering': 'true',
    });
    expect(name).toBe('Cell Biology');
  });

  it('leaves the derived title untouched by default', () => {
    const name = deckNameFor(wrap('3. Cell Biology'), {});
    expect(name).toBe('3. Cell Biology');
  });

  it('never strips a deck name the user typed, even with the option on', () => {
    const name = deckNameFor(wrap('Cell Biology'), {
      'remove-deck-name-numbering': 'true',
      deckName: '3. My Numbered Deck',
    });
    expect(name).toBe('3. My Numbered Deck');
  });

  it('keeps a title that only starts with a number when the option is on', () => {
    const name = deckNameFor(wrap('3D Anatomy'), {
      'remove-deck-name-numbering': 'true',
    });
    expect(name).toBe('3D Anatomy');
  });
});
