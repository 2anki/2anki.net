import { describe, expect, it } from 'vitest';

import {
  EMAIL_DELIVERY_WINDOWS,
  EMAIL_FAILURE_MIN_ATTEMPTS,
  EMAIL_FAILURE_RATE_ALERT_PCT,
} from './emailDeliveryTypes';

describe('email delivery constants', () => {
  it('offers the same window set as the sibling AI usage section', () => {
    expect(EMAIL_DELIVERY_WINDOWS).toEqual(['7d', '14d', '30d', '60d', '90d']);
  });

  it('keeps the badge thresholds in their agreed range', () => {
    expect(EMAIL_FAILURE_RATE_ALERT_PCT).toBe(10);
    expect(EMAIL_FAILURE_MIN_ATTEMPTS).toBe(10);
  });
});
