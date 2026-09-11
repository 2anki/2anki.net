import {
  computeHappyScore,
  HAPPY_SCORE_ASK_EVENT,
  MIN_HAPPY_SCORE_SAMPLE,
} from './happyScore';

describe('computeHappyScore', () => {
  it('counts love as rating 5 and low as ratings 1 and 2', () => {
    const window = computeHappyScore(
      '30d',
      [
        { rating: 1, count: 4 },
        { rating: 2, count: 2 },
        { rating: 5, count: 14 },
      ],
      null
    );
    expect(window).toEqual({
      window: '30d',
      love: 14,
      low: 6,
      n: 20,
      score_pct: 70,
      asks: null,
      response_rate_pct: null,
    });
  });

  it('hides the score below the minimum sample but keeps the counts', () => {
    const window = computeHappyScore(
      '7d',
      [
        { rating: 1, count: 3 },
        { rating: 5, count: MIN_HAPPY_SCORE_SAMPLE - 4 },
      ],
      12
    );
    expect(window).toMatchObject({
      love: MIN_HAPPY_SCORE_SAMPLE - 4,
      low: 3,
      n: MIN_HAPPY_SCORE_SAMPLE - 1,
      score_pct: null,
    });
  });

  it('ignores ratings outside the three widget values', () => {
    const window = computeHappyScore(
      '90d',
      [
        { rating: 3, count: 50 },
        { rating: 4, count: 50 },
        { rating: 5, count: 10 },
      ],
      null
    );
    expect(window).toMatchObject({ love: 10, low: 0, n: 10, score_pct: 100 });
  });

  it('derives the response rate from asks when they are known', () => {
    const window = computeHappyScore(
      '30d',
      [
        { rating: 1, count: 5 },
        { rating: 5, count: 5 },
      ],
      200
    );
    expect(window).toMatchObject({ asks: 200, response_rate_pct: 5 });
  });

  it('reports no response rate when nobody was asked', () => {
    const window = computeHappyScore('30d', [{ rating: 5, count: 1 }], 0);
    expect(window).toMatchObject({ asks: 0, response_rate_pct: null });
  });

  it('rounds the score to one decimal', () => {
    const window = computeHappyScore(
      '30d',
      [
        { rating: 1, count: 1 },
        { rating: 5, count: 11 },
      ],
      null
    );
    expect(window.score_pct).toBe(91.7);
  });

  it('names the ask event that the prompt fires', () => {
    expect(HAPPY_SCORE_ASK_EVENT).toBe('happy_score_ask_shown');
  });
});
