import { resolveAnonymousPartialArm } from './anonymousPartialDelivery';

describe('resolveAnonymousPartialArm', () => {
  it('is off when the flag is disabled regardless of the id', () => {
    expect(resolveAnonymousPartialArm('anon-1', false)).toBe('off');
    expect(resolveAnonymousPartialArm(null, false)).toBe('off');
  });

  it('keeps the limit wall for a request with no anonymous id', () => {
    expect(resolveAnonymousPartialArm(null, true)).toBe('control');
    expect(resolveAnonymousPartialArm('', true)).toBe('control');
  });

  it('holds the deck for every visitor with an anonymous id', () => {
    const arms = new Set(
      Array.from({ length: 200 }, (_, i) =>
        resolveAnonymousPartialArm(`anon-${i}`, true)
      )
    );
    expect(arms).toEqual(new Set(['treatment']));
  });
});
