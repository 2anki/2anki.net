import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CANCELLATION_REASONS,
  CancellationReason,
  REASON_KEYS,
} from './cancellationReasons';
import { formatPassEnd } from '../../../lib/checkout/formatPassEnd';
import styles from '../AccountPage.module.css';
import sharedStyles from '../../../styles/shared.module.css';

export type CancelAccess =
  | { readonly kind: 'untilPeriodEnd'; readonly periodEnd: number | null }
  | { readonly kind: 'notPromised' };

interface CancelFlowProps {
  readonly isCancelling: boolean;
  readonly access: CancelAccess;
  readonly onCancel: (reason: CancellationReason | '', comment: string) => void;
  readonly onKeep: (reason: CancellationReason | '', comment: string) => void;
}

function useAccessNotice(access: CancelAccess): string | null {
  const { t, i18n } = useTranslation('account');
  if (access.kind === 'notPromised') {
    return null;
  }
  const date =
    access.periodEnd == null
      ? null
      : formatPassEnd(
          new Date(access.periodEnd * 1000).toISOString(),
          i18n.language
        );
  return date == null
    ? t('cancelFlow.accessUntilPeriodEnd')
    : t('cancelFlow.accessUntil', { date });
}

export function CancelFlow({
  isCancelling,
  access,
  onCancel,
  onKeep,
}: CancelFlowProps) {
  const { t } = useTranslation('account');
  const accessNotice = useAccessNotice(access);
  const accessNoticeId = useId();
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

      {accessNotice != null && (
        <p id={accessNoticeId} className={styles.dangerNotice}>
          {accessNotice}
        </p>
      )}

      <div className={styles.buttonRow}>
        <button
          type="button"
          className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
          onClick={() => onKeep(reason, comment.trim())}
          disabled={isCancelling}
        >
          {t('cancelFlow.keepSubscription')}
        </button>
        <button
          type="button"
          className={styles.cancelConfirm}
          onClick={() => onCancel(reason, comment.trim())}
          disabled={isCancelling}
          aria-describedby={accessNotice == null ? undefined : accessNoticeId}
        >
          {isCancelling
            ? t('cancelFlow.processing')
            : t('cancelFlow.cancelSubscription')}
        </button>
      </div>
    </fieldset>
  );
}
