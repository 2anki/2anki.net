import { errorName } from './errorName';

describe('errorName', () => {
  it.each([
    [new TypeError('fetch failed https://x?api_secret=s'), 'TypeError'],
    [Object.assign(new Error('x'), { name: 'TimeoutError' }), 'TimeoutError'],
    [new Error('plain'), 'Error'],
    ['a string rejection', 'Error'],
    [null, 'Error'],
    [undefined, 'Error'],
    [{ name: 42 }, 'Error'],
    [{ name: '' }, 'Error'],
  ])('maps %p to %s', (input, expected) => {
    expect(errorName(input)).toBe(expected);
  });
});
