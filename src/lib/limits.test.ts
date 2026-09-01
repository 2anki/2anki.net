import * as limits from './limits';

describe('limits catalog', () => {
  it.each([
    ['FREE_MAP_LIMIT', limits.FREE_MAP_LIMIT, 3],
    ['SUBSCRIBER_MAP_LIMIT', limits.SUBSCRIBER_MAP_LIMIT, 25],
    ['FREE_NODE_LIMIT', limits.FREE_NODE_LIMIT, 50],
    ['SUBSCRIBER_NODE_LIMIT', limits.SUBSCRIBER_NODE_LIMIT, 250],
    [
      'MINDMAP_IMAGE_MAX_BYTES',
      limits.MINDMAP_IMAGE_MAX_BYTES,
      5 * 1024 * 1024,
    ],
    ['MONTHLY_CARD_LIMIT', limits.MONTHLY_CARD_LIMIT, 100],
    ['ANONYMOUS_CARD_CAP', limits.ANONYMOUS_CARD_CAP, 21],
    [
      'FREE_USER_MAX_UPLOAD_SIZE',
      limits.FREE_USER_MAX_UPLOAD_SIZE,
      100 * 1024 * 1024,
    ],
    ['PDF_FREE_MAX_PAGES', limits.PDF_FREE_MAX_PAGES, 100],
    ['CHUNK_SIZE', limits.CHUNK_SIZE, 40_000],
    ['GIANT_INPUT_THRESHOLD', limits.GIANT_INPUT_THRESHOLD, 300_000],
    ['GIANT_INPUT_CHUNK_SIZE', limits.GIANT_INPUT_CHUNK_SIZE, 20_000],
    ['CHUNK_MAX_TOKENS', limits.CHUNK_MAX_TOKENS, 32_768],
  ])('re-exports %s verbatim', (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });
});
