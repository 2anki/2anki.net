import { redactStripeIds } from './redactStripeIds';

describe('redactStripeIds', () => {
  it.each([
    [
      "No such customer: 'cus_Qx1aBcD2eFgH3i'",
      "No such customer: '<stripe_id>'",
    ],
    [
      'update "users" set "stripe_customer_id" = \'cus_ABC123\' where "id" = 7',
      'update "users" set "stripe_customer_id" = \'<stripe_id>\' where "id" = 7',
    ],
    ['sub_1Abc and pi_3Xyz', '<stripe_id> and <stripe_id>'],
    ['session cs_test_a1B2c3 expired', 'session <stripe_id> expired'],
    ['pm_1Q2w3E4r on in_1AbCd', '<stripe_id> on <stripe_id>'],
  ])('redacts %p', (input, expected) => {
    expect(redactStripeIds(input)).toBe(expected);
  });

  it.each([
    'focus_group',
    'custom_field',
    'discuss_this',
    'Cannot read properties of undefined',
    'cus_',
    'in_progress',
    'state is in_review',
  ])('leaves %p alone', (input) => {
    expect(redactStripeIds(input)).toBe(input);
  });
});
