export const EMAIL_DELIVERY_WINDOWS = [
  '7d',
  '14d',
  '30d',
  '60d',
  '90d',
] as const;

export type EmailDeliveryWindow = (typeof EMAIL_DELIVERY_WINDOWS)[number];

export interface EmailDeliveryCategory {
  category: string;
  delivered: number;
  bounce: number;
  dropped: number;
  blocked: number;
  deferred: number;
  spamreport: number;
  unsubscribe: number;
  failure_rate: number;
}

export interface EmailDeliveryResponse {
  window: string;
  by_category: EmailDeliveryCategory[];
}

export const EMAIL_FAILURE_RATE_ALERT_PCT = 10;
export const EMAIL_FAILURE_MIN_ATTEMPTS = 10;
