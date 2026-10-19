import { describe, expect, it } from 'vitest';
import { aiCreditsExhaustedCopyKey } from './aiCreditsExhaustedCopy';

describe('aiCreditsExhaustedCopyKey', () => {
  it('uses the free line for a user with no plan', () => {
    expect(aiCreditsExhaustedCopyKey(undefined)).toBe('aiCreditsExhausted');
    expect(aiCreditsExhaustedCopyKey({})).toBe('aiCreditsExhausted');
  });

  it('uses the plan line for a subscriber', () => {
    expect(aiCreditsExhaustedCopyKey({ subscriber: true })).toBe(
      'aiCreditsExhaustedPlan'
    );
  });

  it('uses the plan line for a lifetime patreon user', () => {
    expect(aiCreditsExhaustedCopyKey({ patreon: true })).toBe(
      'aiCreditsExhaustedPlan'
    );
  });

  it('uses the pass line for a 24h, 7d, or 120d pass holder', () => {
    expect(
      aiCreditsExhaustedCopyKey({ subscriber: true, passKind: '24h' })
    ).toBe('aiCreditsExhaustedPass');
    expect(aiCreditsExhaustedCopyKey({ passKind: '7d' })).toBe(
      'aiCreditsExhaustedPass'
    );
    expect(aiCreditsExhaustedCopyKey({ passKind: '120d' })).toBe(
      'aiCreditsExhaustedPass'
    );
  });

  it('treats an unlimited pass as a plan, since it resets monthly', () => {
    expect(
      aiCreditsExhaustedCopyKey({ subscriber: true, passKind: 'unlimited' })
    ).toBe('aiCreditsExhaustedPlan');
  });
});
