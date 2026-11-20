import { clozeCardOrdinals } from './clozeCardOrdinals';

describe('clozeCardOrdinals', () => {
  it.each([
    ['two clozes', ['{{c1::Oslo}} is in {{c2::Norway}}'], [0, 1]],
    ['a nested cloze', ['{{c1::Oslo is in {{c2::Norway}}}}'], [0, 1]],
    [
      'hinted clozes',
      ['{{c1::Oslo::city}} is in {{c2::Norway::country}}'],
      [0, 1],
    ],
    ['only the second cloze', ['{{c2::Oslo::city}} is in Norway'], [1]],
    ['an unclosed cloze', ['{{c1::Oslo}} is in {{c2::Norway'], [0]],
    ['a close without an open', ['{{c1::Oslo}} is in c2::Norway}}'], [0]],
    ['no clozes', ['no clozes at all'], []],
    ['c0 next to c3', ['{{c0::zero}} and {{c3::three}}'], [2]],
    ['an upper-case C', ['{{C2::upper}} {{c1::x}}'], [0]],
    ['a space before the number', ['{{c 2::space}} {{c1::x}}'], [0]],
    ['a leading zero', ['{{c02::leading}}'], [1]],
    ['an empty cloze', ['{{c2::}} {{c1::x}}'], [0, 1]],
    ['a number past 65535', ['{{c1::a}} {{c99999::big}}'], [0]],
    ['a stray close after a cloze', ['{{c1::a}}}} {{c2::b}}'], [0, 1]],
    ['a cloze inside HTML', ['{{c1::a}} <b>{{c2::b}}</b>'], [0, 1]],
    ['a cloze in a second field', ['plain', '{{c2::in extra}}'], [1]],
    [
      'clozes nested eleven deep',
      [
        '{{c1::{{c2::{{c3::{{c4::{{c5::{{c6::{{c7::{{c8::{{c9::{{c10::{{c11::deep}}}}}}}}}}}}}}}}}}}}}}',
      ],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    ],
  ])(
    'gives the card ordinals Anki reads from %s',
    (_label, fields, expected) => {
      expect([...clozeCardOrdinals(fields)].sort((a, b) => a - b)).toEqual(
        expected
      );
    }
  );
});
