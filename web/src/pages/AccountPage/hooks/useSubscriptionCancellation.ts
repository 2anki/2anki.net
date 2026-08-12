import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  cancelSubscription,
  submitCancellationFeedback,
  CancelMode,
} from '../../../lib/backend/cancelSubscription';
import { CancellationReason } from '../components/CancellationFollowUp';

export function useSubscriptionCancellation(onSuccess?: () => void) {
  const { t } = useTranslation('account');
  const [cancelError, setCancelError] = useState<string>('');
  const [cancelSuccess, setCancelSuccess] = useState<string>('');
  const [showFollowUp, setShowFollowUp] = useState<boolean>(false);

  const formatPeriodEnd = (seconds: number | null | undefined): string => {
    if (!seconds) return t('subscription.billingPeriodEndFallback');
    return new Date(seconds * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const { mutate, isPending: isCancelling } = useMutation({
    mutationFn: ({
      mode,
      reason,
    }: {
      mode: CancelMode;
      periodEnd?: number | null;
      reason?: string;
    }) => cancelSubscription(mode, reason),
    onSuccess: (_data, variables) => {
      setCancelError('');
      setCancelSuccess(
        variables.mode === 'immediate'
          ? t('subscription.cancelledImmediate')
          : t('subscription.cancelledPeriodEnd', {
              date: formatPeriodEnd(variables.periodEnd),
            })
      );
      setShowFollowUp(true);
      onSuccess?.();
    },
    onError: (error: Error) => {
      setCancelSuccess('');
      setShowFollowUp(false);
      setCancelError(error?.message || t('subscription.cancelFailed'));
    },
  });

  const feedback = useMutation({
    mutationFn: ({
      reason,
      comment,
    }: {
      reason: CancellationReason;
      comment: string;
    }) => submitCancellationFeedback(reason, comment),
    onSettled: () => setShowFollowUp(false),
  });

  const cancelUserSubscription = (
    mode: CancelMode = 'period_end',
    periodEnd?: number | null,
    reason?: string
  ) => {
    setCancelError('');
    setCancelSuccess('');
    mutate({ mode, periodEnd, reason });
  };

  const submitFeedback = (reason: CancellationReason, comment: string) => {
    feedback.mutate({ reason, comment });
  };

  const dismissFollowUp = () => setShowFollowUp(false);

  return {
    cancelUserSubscription,
    submitFeedback,
    dismissFollowUp,
    showFollowUp,
    isCancelling,
    isSubmittingFeedback: feedback.isPending,
    cancelError,
    cancelSuccess,
  };
}
