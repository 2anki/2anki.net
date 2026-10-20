import { isLowRating, isSafeReplyTo, resolveFeedbackLink } from './lowRating';

describe('isLowRating', () => {
  it('is true for 1 and 2, false otherwise', () => {
    expect(isLowRating(1)).toBe(true);
    expect(isLowRating(2)).toBe(true);
    expect(isLowRating(3)).toBe(false);
    expect(isLowRating(5)).toBe(false);
  });
});

describe('isSafeReplyTo', () => {
  it('accepts a single clean address and rejects header injection', () => {
    expect(isSafeReplyTo('learner@example.com')).toBe(true);
    expect(isSafeReplyTo('a@b.com\nbcc: victim@example.com')).toBe(false);
    expect(isSafeReplyTo('a@b.com, c@d.com')).toBe(false);
  });
});

describe('resolveFeedbackLink', () => {
  it('passes an in-app path through unchanged', () => {
    expect(resolveFeedbackLink('/upload')).toBe('/upload');
    expect(resolveFeedbackLink('/downloads')).toBe('/downloads');
  });

  it('maps the allowlisted Downloads prompt to its in-app path', () => {
    expect(resolveFeedbackLink('downloads/deck_done')).toBe('/downloads');
  });

  it('returns null for any other value without a leading slash', () => {
    expect(resolveFeedbackLink('https://evil.example.com')).toBeNull();
    expect(resolveFeedbackLink('downloads/other')).toBeNull();
  });

  it('does not let a prototype key escape the allowlist', () => {
    expect(resolveFeedbackLink('toString')).toBeNull();
    expect(resolveFeedbackLink('constructor')).toBeNull();
  });
});
