import type { PassKind } from '../../data_layer/UserPassRepository';

export type PurchaseKind = 'subscription' | 'pass';

export interface HeldEntitlements {
  lifetime: boolean;
  activeSubscription: boolean;
  billedThroughApple: boolean;
  activePassKind: PassKind | null;
  activePassExpiresAt: Date | null;
}

export type PurchaseBlockCode =
  | 'already_lifetime'
  | 'already_unlimited'
  | 'already_subscribed'
  | 'billed_through_apple'
  | 'pass_still_active';

export interface PurchaseBlock {
  code: PurchaseBlockCode;
  message: string;
  expiresAt: string | null;
}

const block = (
  code: PurchaseBlockCode,
  message: string,
  expiresAt: Date | null = null
): PurchaseBlock => ({
  code,
  message,
  expiresAt: expiresAt?.toISOString() ?? null,
});

// One thing at a time, used until it is done. A finite pass is the exception:
// its holder may move to an ongoing plan, because a pass runs out and the
// choice to keep going is a real one rather than a duplicate charge. Credit
// packs never reach here — they are refillable by design.
export const resolvePurchaseBlock = (
  kind: PurchaseKind,
  held: HeldEntitlements
): PurchaseBlock | null => {
  if (held.lifetime) {
    return block('already_lifetime', 'You already have lifetime access.');
  }
  if (held.billedThroughApple) {
    return block(
      'billed_through_apple',
      'Your plan is billed through Apple. Manage it in your Apple subscriptions.'
    );
  }
  if (held.activeSubscription) {
    return block(
      'already_subscribed',
      'You already have an active subscription.'
    );
  }
  if (held.activePassKind === 'unlimited') {
    return block(
      'already_unlimited',
      'You already have unlimited access.',
      held.activePassExpiresAt
    );
  }
  if (kind === 'pass' && held.activePassKind != null) {
    return block(
      'pass_still_active',
      'Your pass is still running. Buy the next one when it runs out.',
      held.activePassExpiresAt
    );
  }
  return null;
};
