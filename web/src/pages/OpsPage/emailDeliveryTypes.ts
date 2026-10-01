export type { EmailDeliveryCategory } from '@server/types/ops/EmailDelivery';
export type { EmailDeliveryMetricsPayload as EmailDeliveryResponse } from '@server/types/ops/EmailDelivery';

export const EMAIL_DELIVERY_WINDOWS = [
  '7d',
  '14d',
  '30d',
  '60d',
  '90d',
] as const;

export type EmailDeliveryWindow = (typeof EMAIL_DELIVERY_WINDOWS)[number];

export const EMAIL_FAILURE_RATE_ALERT_PCT = 10;
export const EMAIL_FAILURE_MIN_ATTEMPTS = 10;
