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

interface CancelFlowProps {
  readonly planLabel: string | null;
  readonly tenureDays: number;
  readonly pauseEligible: boolean;
  readonly isLegacyRate: boolean;
  readonly isCancelling: boolean;
  readonly isPausing: boolean;
  readonly pauseError: string;
  readonly onCancel: (reason: CancellationReason | '', comment: string) => void;
  readonly onKeep: (reason: CancellationReason | '', comment: string) => void;
  readonly onPause: (
    months: PauseMonths,
    reason: CancellationReason | ''
  ) => void;
}

export function CancelFlow({
  planLabel,
  tenureDays,
  pauseEligible,
  isLegacyRate,
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
  const offered = useRef(false);
  const rootRef = useRef<HTMLFieldSetElement>(null);

  const showPause = pauseEligible;

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    if (showPause && !offered.current) {
      offered.current = true;
      track('subscription_pause_offered', { tenure_days: tenureDays });
    }
  }, [showPause, tenureDays]);

  const handlePause = (months: PauseMonths) => {
    track('subscription_paused', {
      pause_months: months,
      tenure_days: tenureDays,
      ...(reason ? { reason } : {}),
    });
    onPause(months, reason);
  };

  return (
    <fieldset
      ref={rootRef}
      tabIndex={-1}
      className={styles.dangerSection}
      aria-label={pauseEligible ? t('cancelFlow.pauseOrCancel') : 'Cancel'}
    >
      {showPause && (
        <PauseCard
          planLabel={planLabel}
          isLegacyRate={isLegacyRate}
          isPausing={isPausing}
          pauseError={pauseError}
          onPause={handlePause}
        />
      )}

      <p className={styles.dangerTitle}>
        {showPause
          ? t('cancelFlow.stillWantToCancel')
          : t('cancelFlow.whyCancelling')}
      </p>
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
    </fieldset>
  );
}
