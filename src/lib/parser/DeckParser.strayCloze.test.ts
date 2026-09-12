import { setupTests } from '../../test/configure-jest';
import CardOption from './Settings/CardOption';
import { DeckParser } from './DeckParser';
import Workspace from './WorkSpace';

beforeEach(() => setupTests());

const togglePage = (answer: string): string =>
  `<html><head><title>Bio</title></head><body><div class="page-body"><ul class="toggle"><li><details open=""><summary>What powers the cell?</summary><p>${answer}</p></details></li></ul></div></body></html>`;

const parse = async (contents: string, cloze: boolean) => {
  const workspace = new Workspace(true, 'fs');
  const parser = new DeckParser({
    name: 'bio.html',
    settings: new CardOption(cloze ? {} : { cloze: 'false' }),
    files: [{ name: 'bio.html', contents }],
    noLimits: true,
    workspace,
  });
  await parser.writeDeckInfo(workspace);
  return parser;
};

describe('stray cloze markup on basic-mode cards (#4402)', () => {
  it('counts a basic card whose answer carries {{c1::…}} and leaves it basic', async () => {
    const parser = await parse(
      togglePage('The {{c1::mitochondria}} does.'),
      false
    );
    const cards = parser.payload.flatMap((deck) => deck.cards);

    expect(parser.strayClozeCount).toBe(1);
    expect(cards).toHaveLength(1);
    expect(cards[0].cloze).toBe(false);
    expect(cards[0].name).toContain('What powers the cell?');
  });

  it('does not count when cloze mode is on', async () => {
    const parser = await parse(
      togglePage('The {{c1::mitochondria}} does.'),
      true
    );
    expect(parser.strayClozeCount).toBe(0);
  });

  it('does not count a basic card without markup', async () => {
    const parser = await parse(togglePage('The mitochondria does.'), false);
    expect(parser.strayClozeCount).toBe(0);
  });
});
