import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CANCELLATION_REASONS,
  CancellationReason,
  REASON_KEYS,
} from './cancellationReasons';
import styles from '../AccountPage.module.css';

interface CancelFlowProps {
  readonly isCancelling: boolean;
  readonly onCancel: (reason: CancellationReason | '', comment: string) => void;
  readonly onKeep: (reason: CancellationReason | '', comment: string) => void;
}

export function CancelFlow({
  isCancelling,
  onCancel,
  onKeep,
}: CancelFlowProps) {
  const { t } = useTranslation('account');
  const [reason, setReason] = useState<CancellationReason | ''>('');
  const [comment, setComment] = useState('');
  const rootRef = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  return (
    <fieldset
      ref={rootRef}
      tabIndex={-1}
      className={styles.dangerSection}
      aria-label={t('cancelFlow.cancelSubscription')}
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
