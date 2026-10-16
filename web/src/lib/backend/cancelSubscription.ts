import { post } from './api';

const UNAUTHORIZED = 401;
const OK = 200;

// The self-serve cancel always ends at the period end; the server enforces
// it, so there is no mode to send.
export const cancelSubscription = async (
  reason?: string
): Promise<{ message: string }> => {
  const body = reason == null ? {} : { reason };
  const response = await post('/api/users/cancel-subscription', body);

  if (response?.status === UNAUTHORIZED) {
    globalThis.location.href = '/login';
    throw new Error('Authentication required');
  }

  if (response?.status !== OK) {
    const fallback = response?.statusText || 'Unknown error';
    const message = await response
      ?.json()
      .then((body: { message?: string }) => body?.message ?? fallback)
      .catch(() => fallback);
    throw new Error(message);
  }

  return response.json();
};

// The server decides how the plan ends: at the period end when one was paid
// for, now when there is none to honour (unpaid or paused).
export const cancelSubscriptionById = async (
  id: string
): Promise<{ message: string }> => {
  const response = await post(
    `/api/users/subscriptions/${encodeURIComponent(id)}/cancel`,
    {}
  );

  if (response?.status === UNAUTHORIZED) {
    globalThis.location.href = '/login';
    throw new Error('Authentication required');
  }

  if (response?.status !== OK) {
    const fallback = response?.statusText || 'Unknown error';
    const message = await response
      ?.json()
      .then((body: { message?: string }) => body?.message ?? fallback)
      .catch(() => fallback);
    throw new Error(message);
  }

  return response.json();
};

export const submitCancellationFeedback = async (
  reason: string,
  comment: string
): Promise<void> => {
  await post('/api/users/cancellation-feedback', { reason, comment });
};
