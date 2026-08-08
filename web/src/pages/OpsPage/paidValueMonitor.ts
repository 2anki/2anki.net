export type PaidValueClassification = 'tried' | 'never';

export interface PassValueRow {
  userId: number;
  kind: string;
  expiresAt: string;
  successes: number;
  downloads: number;
  failures: number;
  classification: PaidValueClassification;
}

export interface SubscriptionValueRow {
  userId: number;
  subscribedAt: string;
  successes: number;
  downloads: number;
  failures: number;
  classification: PaidValueClassification;
}

export interface PassValueGroup {
  checked: number;
  withValue: number;
  zeroValueTried: number;
  zeroValueNeverTried: number;
  rows: PassValueRow[];
}

export interface SubscriptionValueGroup {
  checked: number;
  withValue: number;
  zeroValueTried: number;
  zeroValueNeverTried: number;
  rows: SubscriptionValueRow[];
}

export interface PaidValueMonitorResponse {
  window_since: string;
  as_of: string;
  passes: PassValueGroup;
  claimedAnonymousPasses: PassValueGroup;
  unclaimedAnonymousPasses: number;
  newSubscriptions: SubscriptionValueGroup;
}

export const PAID_VALUE_WINDOWS = ['1d', '7d', '14d', '30d'] as const;
export type PaidValueWindow = (typeof PAID_VALUE_WINDOWS)[number];

export async function getPaidValueMonitor(
  window: PaidValueWindow
): Promise<PaidValueMonitorResponse> {
  const response = await fetch(`/api/ops/value-monitor?window=${window}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.message ?? `${response.status} ${response.statusText}`
    );
  }
  return response.json();
}
