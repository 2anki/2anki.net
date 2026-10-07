import { vi, type MockInstance } from 'vitest';
import { logEmptyBackAttribution } from './logEmptyBackAttribution';

describe('logEmptyBackAttribution', () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function payloads(): unknown[] {
    return logSpy.mock.calls
      .map(([line]) => line as string)
      .filter((line) => line.startsWith('[empty-backs] '))
      .map((line) => JSON.parse(line.slice('[empty-backs] '.length)));
  }

  it('logs one line per deck when the empty-back ratio exceeds 20%', () => {
    logEmptyBackAttribution(
      [{ emptyBackCount: 3, cardCount: 10, parsePath: 'html:toggle' }],
      'upload'
    );

    expect(payloads()).toEqual([
      {
        parsePath: 'html:toggle',
        emptyBackCount: 3,
        cardCount: 10,
        source: 'upload',
      },
    ]);
  });

  it('does not log when the empty-back ratio is exactly 20%', () => {
    logEmptyBackAttribution(
      [{ emptyBackCount: 2, cardCount: 10, parsePath: 'html:toggle' }],
      'upload'
    );

    expect(payloads()).toEqual([]);
  });

  it('does not log when the empty-back ratio is below 20%', () => {
    logEmptyBackAttribution(
      [{ emptyBackCount: 5, cardCount: 100, parsePath: 'html:toggle' }],
      'upload'
    );

    expect(payloads()).toEqual([]);
  });

  it('skips decks with fewer than 10 cards even when every back is empty', () => {
    logEmptyBackAttribution(
      [{ emptyBackCount: 9, cardCount: 9, parsePath: 'html:toggle' }],
      'upload'
    );

    expect(payloads()).toEqual([]);
  });

  it('falls back to unknown when the deck carries no parse path', () => {
    logEmptyBackAttribution(
      [{ emptyBackCount: 8, cardCount: 20 }],
      'google_drive'
    );

    expect(payloads()).toEqual([
      {
        parsePath: 'unknown',
        emptyBackCount: 8,
        cardCount: 20,
        source: 'google_drive',
      },
    ]);
  });

  it('emits only for the decks over the threshold in a batch', () => {
    logEmptyBackAttribution(
      [
        { emptyBackCount: 3, cardCount: 10, parsePath: 'html:toggle' },
        { emptyBackCount: 0, cardCount: 40, parsePath: 'html:table' },
        { emptyBackCount: 30, cardCount: 50, parsePath: 'markdown' },
      ],
      'upload'
    );

    expect(payloads()).toEqual([
      {
        parsePath: 'html:toggle',
        emptyBackCount: 3,
        cardCount: 10,
        source: 'upload',
      },
      {
        parsePath: 'markdown',
        emptyBackCount: 30,
        cardCount: 50,
        source: 'upload',
      },
    ]);
  });
});
