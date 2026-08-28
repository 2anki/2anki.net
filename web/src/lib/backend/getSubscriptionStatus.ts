import { get } from './api';

export interface StripePlanSummary {
  amount: number | null;
  currency: string | null;
  interval: string | null;
}

export interface StripeSubscriptionSummary {
  id: string;
  status: string;
  created: number | null;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  canceled_at: number | null;
  current_period_end: number | null;
  paused_until: number | null;
  cancellation_reason: string | null;
  plan: StripePlanSummary | null;
}

export interface SubscriptionStatusResponse {
  subscriptions: StripeSubscriptionSummary[];
}

export const getSubscriptionStatus =
  async (): Promise<SubscriptionStatusResponse> => {
    const data = await get('/api/users/subscription-status');
    return data ?? { subscriptions: [] };
  };
