import CardOption from './Settings/CardOption';
import { buildDeckStyle, withDeckStyle } from './buildDeckStyle';

describe('buildDeckStyle', () => {
  it('carries the Notion highlight, callout and block colour rules', () => {
    const style = buildDeckStyle(new CardOption({}));
    expect(style).toContain('.highlight-red_background');
    expect(style).toContain('.block-color-gray_background');
    expect(style).toContain('.callout');
  });

  it('spaces nested bullets like top-level ones', () => {
    const style = buildDeckStyle(new CardOption({}));
    expect(style).toContain('li { margin-block: 0.25em; }');
    expect(style).toContain('li > div > ul, li > div > ol');
  });

  it('applies the font size setting', () => {
    expect(buildDeckStyle(new CardOption({ 'font-size': '32' }))).toContain(
      '* { font-size:32px}'
    );
  });
});

describe('withDeckStyle', () => {
  it('replaces whatever style the decks carried with the settings style', () => {
    const settings = new CardOption({});
    const decks = withDeckStyle(
      [
        { name: 'a', style: null },
        { name: 'b', style: '.page-own { color: hotpink; }' },
      ],
      settings
    );
    expect(decks.map((d) => d.style)).toEqual([
      buildDeckStyle(settings),
      buildDeckStyle(settings),
    ]);
  });
});

describe('withDeckStyle style change time', () => {
  it('stamps the settings style change time next to the deck settings', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1793275200 * 1000);
    try {
      const decks = withDeckStyle(
        [{ name: 'a', style: null, settings: { template: 'specialstyle' } }],
        new CardOption({ 'style-changed-at': '1793000000' })
      );
      expect(decks[0].settings).toEqual({
        template: 'specialstyle',
        styleChangedAt: 1793000000,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
