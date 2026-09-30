import { HeldEntitlements, resolvePurchaseBlock } from './resolvePurchaseBlock';

const nothing: HeldEntitlements = {
  lifetime: false,
  activeSubscription: false,
  billedThroughApple: false,
  activePassKind: null,
  activePassExpiresAt: null,
};

const expiry = new Date('2026-11-01T10:00:00.000Z');

describe('resolvePurchaseBlock', () => {
  it('lets someone who owns nothing buy either thing', () => {
    expect(resolvePurchaseBlock('subscription', nothing)).toBeNull();
    expect(resolvePurchaseBlock('pass', nothing)).toBeNull();
  });

  it.each(['subscription', 'pass'] as const)(
    'blocks a %s for a lifetime holder',
    (kind) => {
      expect(
        resolvePurchaseBlock(kind, { ...nothing, lifetime: true })
      ).toEqual({
        code: 'already_lifetime',
        message: 'You already have lifetime access.',
        expiresAt: null,
      });
    }
  );

  it.each(['subscription', 'pass'] as const)(
    'blocks a %s for an active subscriber',
    (kind) => {
      expect(
        resolvePurchaseBlock(kind, { ...nothing, activeSubscription: true })
      ).toEqual({
        code: 'already_subscribed',
        message: 'You already have an active subscription.',
        expiresAt: null,
      });
    }
  );

  it.each(['subscription', 'pass'] as const)(
    'blocks a %s billed through Apple, which we cannot cancel for them',
    (kind) => {
      expect(
        resolvePurchaseBlock(kind, { ...nothing, billedThroughApple: true })
      ).toEqual({
        code: 'billed_through_apple',
        message:
          'Your plan is billed through Apple. Manage it in your Apple subscriptions.',
        expiresAt: null,
      });
    }
  );

  it.each(['24h', '7d', '120d'] as const)(
    'blocks a second pass while a %s pass is still running, and says when it ends',
    (activePassKind) => {
      expect(
        resolvePurchaseBlock('pass', {
          ...nothing,
          activePassKind,
          activePassExpiresAt: expiry,
        })
      ).toEqual({
        code: 'pass_still_active',
        message:
          'Your pass is still running. Buy the next one when it runs out.',
        expiresAt: '2026-11-01T10:00:00.000Z',
      });
    }
  );

  it.each(['24h', '7d', '120d'] as const)(
    'lets a %s pass holder move to a subscription, because a pass runs out',
    (activePassKind) => {
      expect(
        resolvePurchaseBlock('subscription', {
          ...nothing,
          activePassKind,
          activePassExpiresAt: expiry,
        })
      ).toBeNull();
    }
  );

  it.each(['subscription', 'pass'] as const)(
    'blocks a %s for an unlimited pass, which does not run out',
    (kind) => {
      expect(
        resolvePurchaseBlock(kind, {
          ...nothing,
          activePassKind: 'unlimited',
          activePassExpiresAt: expiry,
        })
      ).toEqual({
        code: 'already_unlimited',
        message: 'You already have unlimited access.',
        expiresAt: '2026-11-01T10:00:00.000Z',
      });
    }
  );

  it('reports lifetime first when someone holds lifetime and a pass', () => {
    expect(
      resolvePurchaseBlock('pass', {
        ...nothing,
        lifetime: true,
        activePassKind: '7d',
        activePassExpiresAt: expiry,
      })?.code
    ).toBe('already_lifetime');
  });
});
