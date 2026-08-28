import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CANCELLATION_REASONS,
  CancellationReason,
  REASON_KEYS,
} from './cancellationReasons';
import { PauseCard } from './PauseCard';
import { PauseMonths } from '../../../lib/backend/pauseSubscription';
import { track } from '../../../lib/analytics/track';
import styles from '../AccountPage.module.css';

export const LIFECYCLE_REASONS: readonly CancellationReason[] = [
  'I finished what I needed',
  "I don't use it enough",
];

export const isLifecycleReason = (reason: CancellationReason | ''): boolean =>
  LIFECYCLE_REASONS.includes(reason as CancellationReason);

interface CancelFlowProps {
  readonly planLabel: string | null;
  readonly tenureDays: number;
  readonly pauseEligible: boolean;
  readonly isCancelling: boolean;
  readonly isPausing: boolean;
  readonly pauseError: string;
  readonly onCancel: (reason: CancellationReason | '', comment: string) => void;
  readonly onKeep: (reason: CancellationReason | '', comment: string) => void;
  readonly onPause: (months: PauseMonths, reason: CancellationReason) => void;
}

export function CancelFlow({
  planLabel,
  tenureDays,
  pauseEligible,
  isCancelling,
  isPausing,
  pauseError,
  onCancel,
  onKeep,
  onPause,
}: CancelFlowProps) {
  const { t } = useTranslation('account');
  const [reason, setReason] = useState<CancellationReason | ''>('');
  const [comment, setComment] = useState('');
  const offeredReasons = useRef<Set<CancellationReason>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  const showPause = pauseEligible && isLifecycleReason(reason);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    if (
      showPause &&
      reason !== '' &&
      !offeredReasons.current.has(reason as CancellationReason)
    ) {
      offeredReasons.current.add(reason as CancellationReason);
      track('subscription_pause_offered', {
        reason,
        tenure_days: tenureDays,
      });
    }
  }, [showPause, reason, tenureDays]);

  const handlePause = (months: PauseMonths) => {
    if (reason === '') return;
    track('subscription_paused', {
      pause_months: months,
      reason,
      tenure_days: tenureDays,
    });
    onPause(months, reason);
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className={styles.dangerSection}
      role="group"
      aria-label="Cancel"
    >
      <p className={styles.dangerTitle}>{t('cancelFlow.whyCancelling')}</p>
      <div className={styles.reasonList}>
        {CANCELLATION_REASONS.map((r) => (
          <label key={r} className={styles.reasonOption}>
            <input
              type="radio"
              name="cancel-flow-reason"
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
            />
            {t(REASON_KEYS[r])}
          </label>
        ))}
      </div>

      {reason !== '' && (
        <textarea
          className={styles.reasonComment}
          aria-label={t('cancelFlow.commentAria')}
          placeholder={
            reason === 'Technical issues'
              ? t('cancelFlow.commentPlaceholderTechnical')
              : t('cancelFlow.commentPlaceholder')
          }
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          maxLength={1000}
        />
      )}

      {showPause && (
        <PauseCard
          planLabel={planLabel}
          isPausing={isPausing}
          pauseError={pauseError}
          onPause={handlePause}
        />
      )}

      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => onCancel(reason, comment.trim())}
          disabled={isCancelling}
        >
          {isCancelling
            ? t('cancelFlow.processing')
            : t('cancelFlow.cancelSubscription')}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => onKeep(reason, comment.trim())}
          disabled={isCancelling}
        >
          {t('cancelFlow.keepSubscription')}
        </button>
      </div>
    </div>
  );
}
