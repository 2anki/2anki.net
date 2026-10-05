import { hasAnkifyAccess, AnkifyAccessSubscription } from './access';

const AUTO_SYNC_PRODUCT_ID = 'prod_test_auto_sync';

const activeAutoSyncSub = (productId: string): AnkifyAccessSubscription => ({
  active: true,
  stripe_product_id: productId,
});

const inactiveSub = (productId: string): AnkifyAccessSubscription => ({
  active: false,
  stripe_product_id: productId,
});

const activeOtherSub = (): AnkifyAccessSubscription => ({
  active: true,
  stripe_product_id: 'prod_unlimited_other',
});

describe('hasAnkifyAccess', () => {
  test('returns false for null/undefined user', () => {
    expect(hasAnkifyAccess(null, [], AUTO_SYNC_PRODUCT_ID)).toBe(false);
    expect(hasAnkifyAccess(undefined, [], AUTO_SYNC_PRODUCT_ID)).toBe(false);
  });

  test('returns false when patreon is null and no subscriptions', () => {
    expect(hasAnkifyAccess({ patreon: null }, [], AUTO_SYNC_PRODUCT_ID)).toBe(
      false
    );
  });

  test('returns false when patreon is false and no subscriptions', () => {
    expect(hasAnkifyAccess({ patreon: false }, [], AUTO_SYNC_PRODUCT_ID)).toBe(
      false
    );
  });

  test('returns true when patreon is true (grandfathered)', () => {
    expect(hasAnkifyAccess({ patreon: true }, [], AUTO_SYNC_PRODUCT_ID)).toBe(
      true
    );
  });

  test('returns true when ankify_access is granted, without patreon or a sub', () => {
    expect(
      hasAnkifyAccess(
        { patreon: false, ankify_access: true },
        [],
        AUTO_SYNC_PRODUCT_ID
      )
    ).toBe(true);
  });

  test('returns false when ankify_access is false and there is no other access', () => {
    expect(
      hasAnkifyAccess(
        { patreon: false, ankify_access: false },
        [],
        AUTO_SYNC_PRODUCT_ID
      )
    ).toBe(false);
  });

  test('returns true when active Auto Sync subscription matches product ID', () => {
    const subs = [activeAutoSyncSub(AUTO_SYNC_PRODUCT_ID)];
    expect(
      hasAnkifyAccess({ patreon: false }, subs, AUTO_SYNC_PRODUCT_ID)
    ).toBe(true);
  });

  test('returns false when subscription is inactive for Auto Sync product', () => {
    const subs = [inactiveSub(AUTO_SYNC_PRODUCT_ID)];
    expect(
      hasAnkifyAccess({ patreon: false }, subs, AUTO_SYNC_PRODUCT_ID)
    ).toBe(false);
  });

  test('returns false when subscription is active but for a different product', () => {
    const subs = [activeOtherSub()];
    expect(
      hasAnkifyAccess({ patreon: false }, subs, AUTO_SYNC_PRODUCT_ID)
    ).toBe(false);
  });

  test('returns false when stripe_product_id is null on an active subscription', () => {
    const subs: AnkifyAccessSubscription[] = [
      { active: true, stripe_product_id: null },
    ];
    expect(
      hasAnkifyAccess({ patreon: false }, subs, AUTO_SYNC_PRODUCT_ID)
    ).toBe(false);
  });

  test('returns true when patreon is true even with no matching subscription', () => {
    const subs = [activeOtherSub()];
    expect(hasAnkifyAccess({ patreon: true }, subs, AUTO_SYNC_PRODUCT_ID)).toBe(
      true
    );
  });

  test('returns true with active Auto Sync sub even when patreon is null', () => {
    const subs = [activeAutoSyncSub(AUTO_SYNC_PRODUCT_ID)];
    expect(hasAnkifyAccess({ patreon: null }, subs, AUTO_SYNC_PRODUCT_ID)).toBe(
      true
    );
  });

  test('returns false when subscriptions is undefined and patreon is false', () => {
    expect(
      hasAnkifyAccess(
        { patreon: false },
        undefined as unknown as never[],
        AUTO_SYNC_PRODUCT_ID
      )
    ).toBe(false);
  });

  test('returns false when subscriptions is null and patreon is false', () => {
    expect(
      hasAnkifyAccess(
        { patreon: false },
        null as unknown as never[],
        AUTO_SYNC_PRODUCT_ID
      )
    ).toBe(false);
  });

  test('returns true when subscriptions is undefined but patreon is true', () => {
    expect(
      hasAnkifyAccess(
        { patreon: true },
        undefined as unknown as never[],
        AUTO_SYNC_PRODUCT_ID
      )
    ).toBe(true);
  });

  test('returns true when subscriptions is null but patreon is true', () => {
    expect(
      hasAnkifyAccess(
        { patreon: true },
        null as unknown as never[],
        AUTO_SYNC_PRODUCT_ID
      )
    ).toBe(true);
  });
});
