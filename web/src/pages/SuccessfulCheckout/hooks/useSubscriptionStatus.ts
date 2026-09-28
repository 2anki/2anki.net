import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { stripUrlParam } from '../../../lib/stripUrlParam';

interface SubscriptionStatus {
  authenticated: boolean;
  hasActiveSubscription: boolean;
  user?: {
    email: string;
    name: string;
    patreon: boolean;
  };
}

const fetchSubscriptionStatus = async (
  sessionId: string | null
): Promise<SubscriptionStatus> => {
  const url = sessionId
    ? `/api/stripe/subscription-status?session_id=${encodeURIComponent(
        sessionId
      )}`
    : '/api/stripe/subscription-status';
  const response = await fetch(url, {
    credentials: 'include',
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Subscription status check failed (${response.status}): ${body}`
    );
  }
  return response.json();
};

const CONFIRMATION_DELAY_MS = 600;

export const useSubscriptionStatus = () => {
  const [shouldPoll, setShouldPoll] = useState(true);
  const [timeoutReached, setTimeoutReached] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [sessionId] = useState(() =>
    new URLSearchParams(globalThis.location.search).get('session_id')
  );

  useEffect(() => {
    stripUrlParam('session_id');
  }, []);

  const query = useQuery({
    queryKey: ['subscription-status', sessionId],
    queryFn: () => fetchSubscriptionStatus(sessionId),
    refetchInterval: shouldPoll ? 2000 : false,
    retry: 3,
    retryDelay: 1000,
  });

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setTimeoutReached(true);
      setShouldPoll(false);
    }, 90000);

    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!query.data) {
      return;
    }

    if (!query.data.authenticated) {
      setShouldPoll(false);
    }

    if (
      query.data.hasActiveSubscription ||
      (query.data.authenticated && timeoutReached)
    ) {
      const destination = query.data.authenticated
        ? '/account?subscribed=1'
        : '/notion';

      const dedupeKey = sessionId ? `purchase_fired_${sessionId}` : null;

      if (dedupeKey && sessionStorage.getItem(dedupeKey)) {
        globalThis.location.href = destination;
        return;
      }

      if (dedupeKey) {
        sessionStorage.setItem(dedupeKey, '1');
      }

      setShouldPoll(false);
      setShowConfirmation(true);

      setTimeout(() => {
        globalThis.location.href = destination;
      }, CONFIRMATION_DELAY_MS);
    }
  }, [query.data, timeoutReached, sessionId]);

  return {
    ...query,
    timeoutReached,
    showConfirmation,
    shouldShowLoading:
      query.isLoading ||
      (shouldPoll &&
        query.data?.authenticated &&
        !query.data?.hasActiveSubscription),
  };
};
