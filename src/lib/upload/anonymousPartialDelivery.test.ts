import { resolveAnonymousPartialArm } from './anonymousPartialDelivery';

describe('resolveAnonymousPartialArm', () => {
  it('keeps the limit wall for a request with no anonymous id', () => {
    expect(resolveAnonymousPartialArm(null)).toBe('control');
    expect(resolveAnonymousPartialArm('')).toBe('control');
  });

  it('holds the deck for every visitor with an anonymous id', () => {
    const arms = new Set(
      Array.from({ length: 200 }, (_, i) =>
        resolveAnonymousPartialArm(`anon-${i}`)
      )
    );
    expect(arms).toEqual(new Set(['treatment']));
  });
});
