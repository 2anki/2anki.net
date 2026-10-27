import type { PassKind } from '../../data_layer/UserPassRepository';
import { isAppleSubscriptionPass } from './isAppleSubscriptionPass';

describe('isAppleSubscriptionPass', () => {
  const cases: Array<[PassKind, string, boolean]> = [
    ['unlimited', 'apple:2000000000000001', true],
    ['unlimited', 'pi_3QfixtureUnlimited', false],
    ['120d', 'apple:2000000000000002', false],
    ['7d', 'pi_3QfixtureWeek', false],
  ];

  it.each(cases)(
    'reads a %s pass keyed %s as an Apple subscription: %s',
    (kind, key, expected) => {
      expect(
        isAppleSubscriptionPass({ kind, stripe_payment_intent_id: key })
      ).toBe(expected);
    }
  );
});
