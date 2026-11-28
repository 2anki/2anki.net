import { filesLeftOutOfGiftJob } from './giftMonthCards';

const claude = (cardCount: number) => ({
  packages: [{ engine: 'claude' as const, cardCount }],
});
const parser = (cardCount: number) => ({
  packages: [{ engine: 'parser' as const, cardCount }],
});
const ownConverter = (cardCount: number) => ({ packages: [{ cardCount }] });

describe('filesLeftOutOfGiftJob', () => {
  it('leaves nothing out of a job with no Claude cards, however far past the month', () => {
    expect(filesLeftOutOfGiftJob([parser(100), parser(100)], 100)).toEqual([]);
  });

  it('keeps a file whose cards fill exactly what is left of the month', () => {
    expect(filesLeftOutOfGiftJob([claude(20), parser(25)], 25)).toEqual([]);
  });

  it('leaves out a file whose cards pass what is left by one', () => {
    const over = ownConverter(26);

    expect(filesLeftOutOfGiftJob([claude(20), over], 25)).toEqual([over]);
  });

  it('takes files in order and keeps a later one that still fits', () => {
    const first = parser(80);
    const second = parser(80);
    const small = parser(20);

    expect(
      filesLeftOutOfGiftJob([claude(20), first, second, small], 100)
    ).toEqual([second]);
  });

  it('never leaves out a file with Claude cards, nor counts its Claude cards against the month', () => {
    expect(filesLeftOutOfGiftJob([claude(100), parser(10)], 10)).toEqual([]);
  });

  it('leaves out every other file when the month has no cards left', () => {
    const csv = parser(1);

    expect(filesLeftOutOfGiftJob([claude(20), csv], 0)).toEqual([csv]);
  });
});
