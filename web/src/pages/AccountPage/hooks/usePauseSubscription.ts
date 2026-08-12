import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  pauseSubscription,
  resumeSubscription,
  PauseMonths,
} from '../../../lib/backend/pauseSubscription';

export function usePauseSubscription(onSuccess?: () => void) {
  const { t } = useTranslation('account');
  const [pauseError, setPauseError] = useState<string>('');
  const [resumeError, setResumeError] = useState<string>('');

  const pause = useMutation({
    mutationFn: ({ months }: { months: PauseMonths }) =>
      pauseSubscription(months),
    onSuccess: () => {
      setPauseError('');
      onSuccess?.();
    },
    onError: (error: Error) => {
      setPauseError(error?.message || t('subscription.pauseFailed'));
    },
  });

  const resume = useMutation({
    mutationFn: () => resumeSubscription(),
    onSuccess: () => {
      setResumeError('');
      onSuccess?.();
    },
    onError: (error: Error) => {
      setResumeError(error?.message || t('subscription.resumeFailed'));
    },
  });

  return {
    pauseSubscriptionForMonths: (months: PauseMonths) => {
      setPauseError('');
      pause.mutate({ months });
    },
    resumeSubscriptionNow: () => {
      setResumeError('');
      resume.mutate();
    },
    isPausing: pause.isPending,
    isResuming: resume.isPending,
    pauseError,
    resumeError,
  };
}
