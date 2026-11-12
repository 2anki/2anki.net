import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { resumeSubscription } from '../../../lib/backend/resumeSubscription';

export function useResumeSubscription(onSuccess?: () => void) {
  const { t } = useTranslation('account');
  const [resumeError, setResumeError] = useState<string>('');

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
    resumeSubscriptionNow: () => {
      setResumeError('');
      resume.mutate();
    },
    isResuming: resume.isPending,
    resumeError,
  };
}
