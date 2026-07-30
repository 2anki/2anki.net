import { guidFor } from './guid';

const GENANKI_VECTORS: Array<{ args: Array<string | number>; guid: string }> = [
  { args: ['3647ab29-a11e-80a0-8f6f-f23a6c203d4e'], guid: 'LRX*dO0[7}' },
  { args: ['3917ab29-a11e-8047-9d97-cf0f00b3c8f7'], guid: 'l@Cd.uzPA3' },
  { args: ['c94d97e2-5d91-479c-9a1c-49799823bc9f'], guid: 'xD`j77z<VK' },
  { args: ['23b40f2c-3dba-49d5-b38b-735ce6483110'], guid: 'noy-;K0O6x' },
  { args: ['b38e3642-358c-4ca7-aef5-4c409d27ecf4'], guid: 'Om15k1LagY' },
  { args: ['3647ab29-a11e-80a0-8f6f-f23a6c203d4e::0'], guid: 't*4,@CGW|k' },
  { args: ['3647ab29-a11e-80a0-8f6f-f23a6c203d4e::11'], guid: 'B#/MoB~v[t' },
  { args: ['3647ab29-a11e-80a0-8f6f-f23a6c203d4e::rev'], guid: 'BohqBHt9<S' },
  { args: [''], guid: 'ME_YHw2?15' },
  { args: ['a'], guid: 'IkF(BOZ;]l' },
  { args: ['0'], guid: 'qn?z+W(gM{' },
  { args: ['äöü ß emoji 📖 test'], guid: 'ti%Rzh:{0i' },
  {
    args: [
      '📖 Finanzbuchhaltung Allgemein',
      "<div class='toggle'>Was ist X?</div>",
      'cloze',
    ],
    guid: 'Bj.{CD|nUO',
  },
  { args: ['Deck', 'front', 'basic'], guid: 't:%^!&3TCZ' },
  { args: ['Deck', 'front', 'mcq'], guid: 'wFBZB$yWe1' },
  { args: ['Deck', 'front', 'input'], guid: 'z|j7;,y!Bo' },
  { args: ['A__B', 'C', 'basic'], guid: 'NOYHfbqZT_' },
  { args: ['日本語デッキ', '問題', 'cloze'], guid: 'BLt3{`}uU-' },
  {
    args: ['Deck with spaces', '<p id="x" dir="auto">hi</p>', 'basic'],
    guid: 'OpGJrh#S-H',
  },
  { args: [12345, 'num', 'basic'], guid: 'vF},bMi^9Q' },
];

describe('guidFor', () => {
  it.each(GENANKI_VECTORS)(
    'matches genanki guid_for byte-for-byte for %j',
    ({ args, guid }) => {
      expect(guidFor(...args)).toBe(guid);
    }
  );

  it('is deterministic across calls', () => {
    expect(guidFor('same', 'input')).toBe(guidFor('same', 'input'));
  });

  it('changes when any component changes', () => {
    expect(guidFor('a', 'b', 'basic')).not.toBe(guidFor('a', 'b', 'cloze'));
    expect(guidFor('block-id')).not.toBe(guidFor('block-id::rev'));
  });
});
