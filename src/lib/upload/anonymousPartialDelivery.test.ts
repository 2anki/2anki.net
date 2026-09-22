import { resolveAnonymousPartialArm } from './anonymousPartialDelivery';

describe('resolveAnonymousPartialArm', () => {
  it('is off when the flag is disabled regardless of the id', () => {
    expect(resolveAnonymousPartialArm('anon-1', false)).toBe('off');
    expect(resolveAnonymousPartialArm(null, false)).toBe('off');
  });

  it('puts a request with no anonymous id in the control arm when enabled', () => {
    expect(resolveAnonymousPartialArm(null, true)).toBe('control');
    expect(resolveAnonymousPartialArm('', true)).toBe('control');
  });

  it('assigns a stable arm for the same id', () => {
    const first = resolveAnonymousPartialArm('anon-stable', true);
    const second = resolveAnonymousPartialArm('anon-stable', true);
    expect(second).toBe(first);
    expect(['control', 'treatment']).toContain(first);
  });

  it('splits ids across both arms when enabled', () => {
    const arms = new Set(
      Array.from({ length: 200 }, (_, i) =>
        resolveAnonymousPartialArm(`anon-${i}`, true)
      )
    );
    expect(arms).toEqual(new Set(['control', 'treatment']));
  });
});
