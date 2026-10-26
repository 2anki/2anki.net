import { buildDeckStyle } from '../../lib/parser/buildDeckStyle';
import CardOption from '../../lib/parser/Settings/CardOption';
import Note from '../../lib/parser/Note';
import { buildMindmapDeckInfo } from './buildMindmapDeckInfo';

describe('buildMindmapDeckInfo', () => {
  it('returns one deck with the provided name and default settings', () => {
    const deckInfo = buildMindmapDeckInfo('My deck', []);
    expect(deckInfo).toHaveLength(1);
    expect(deckInfo[0].name).toBe('My deck');
    expect(deckInfo[0].image).toBe('');
    expect(deckInfo[0].style).toBe(buildDeckStyle(new CardOption({})));
    expect(deckInfo[0].settings).toEqual({
      template: 'specialstyle',
      clozeModelName: 'n2a-cloze',
      basicModelName: 'n2a-basic',
      inputModelName: 'n2a-input',
      useNotionId: false,
    });
  });

  it('generates a deck id within the 1e13 range', () => {
    const deckInfo = buildMindmapDeckInfo('d', []);
    expect(Number.isInteger(deckInfo[0].id)).toBe(true);
    expect(deckInfo[0].id).toBeGreaterThanOrEqual(0);
    expect(deckInfo[0].id).toBeLessThan(1e13);
  });

  it('maps each note to a card with a sequential number', () => {
    const a = new Note('front A', 'back A');
    const b = new Note('front B', 'back B');
    const deckInfo = buildMindmapDeckInfo('d', [a, b]);

    expect(deckInfo[0].cards).toHaveLength(2);
    expect(deckInfo[0].cards[0]).toMatchObject({
      name: 'front A',
      back: 'back A',
      number: 0,
    });
    expect(deckInfo[0].cards[1]).toMatchObject({
      name: 'front B',
      back: 'back B',
      number: 1,
    });
  });

  it('passes media through to the card', () => {
    const note = new Note('front', 'back');
    note.media = ['image-1.png', 'image-2.png'];
    const deckInfo = buildMindmapDeckInfo('d', [note]);
    expect(deckInfo[0].cards[0].media).toEqual(['image-1.png', 'image-2.png']);
  });

  it('produces a distinct id on each call', () => {
    const first = buildMindmapDeckInfo('d', [])[0].id;
    const second = buildMindmapDeckInfo('d', [])[0].id;
    expect(first).not.toBe(second);
  });
});
