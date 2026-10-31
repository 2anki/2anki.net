import { isAppleRelayAddress } from './isAppleRelayAddress';

describe('isAppleRelayAddress', () => {
  it.each([
    ['abc123@privaterelay.appleid.com', true],
    ['  ABC123@PrivateRelay.AppleID.com ', true],
    ['learner@example.com', false],
    ['privaterelay.appleid.com@example.com', false],
    ['learner@notprivaterelay.appleid.com.example', false],
  ])('%s → %s', (email, expected) => {
    expect(isAppleRelayAddress(email)).toBe(expected);
  });
});
