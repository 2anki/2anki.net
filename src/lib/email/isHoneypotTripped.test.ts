import { isHoneypotTripped } from './isHoneypotTripped';

describe('isHoneypotTripped', () => {
  it.each([
    ['undefined (field absent from the request)', undefined],
    ['null', null],
    ['empty string (human left the hidden field alone)', ''],
    ['whitespace only', '   '],
    ['empty array (repeated empty field)', []],
  ])('stays quiet for %s', (_label, value) => {
    expect(isHoneypotTripped(value)).toBe(false);
  });

  it.each([
    ['a URL a bot autofilled', 'https://spam.example.ru'],
    ['a phone-shaped probe', '9285284646'],
    ['an array with a value', ['gotcha']],
    ['a single character', 'x'],
  ])('trips for %s', (_label, value) => {
    expect(isHoneypotTripped(value)).toBe(true);
  });
});
