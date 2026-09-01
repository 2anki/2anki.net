import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../AccountPage.module.css';
import sharedStyles from '../../../styles/shared.module.css';
import { PauseMonths } from '../../../lib/backend/pauseSubscription';

const PAUSE_LENGTHS: PauseMonths[] = [1, 2, 3];

const addMonths = (from: Date, months: number): Date => {
  const next = new Date(from.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
};

const formatDate = (date: Date): string =>
  date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

interface PauseCardProps {
  readonly planLabel: string | null;
  readonly isLegacyRate: boolean;
  readonly isPausing: boolean;
  readonly pauseError: string;
  readonly onPause: (months: PauseMonths) => void;
}

export function PauseCard({
  planLabel,
  isLegacyRate,
  isPausing,
  pauseError,
  onPause,
}: PauseCardProps) {
  const { t } = useTranslation('account');
  const [months, setMonths] = useState<PauseMonths | null>(null);

  const resumeDate = months == null ? null : addMonths(new Date(), months);
  const planText = planLabel ?? t('pauseCard.yourPlan');

  return (
    <div className={`${styles.section} ${sharedStyles.marginTopLg}`}>
      <p className={styles.dangerTitle}>{t('pauseCard.pauseInstead')}</p>
      <p className={styles.dangerNotice}>{t('pauseCard.notice')}</p>
      {isLegacyRate && (
        <p className={styles.legacyNote}>
          {t('pauseCard.legacyKeeps', { plan: planText })}
        </p>
      )}

      <p className={styles.dangerTitle}>{t('pauseCard.pauseFor')}</p>
      <div
        className={styles.buttonRow}
        role="group"
        aria-label={t('pauseCard.pauseLengthAria')}
      >
        {PAUSE_LENGTHS.map((length) => (
          <button
            key={length}
            type="button"
            className={
              months === length
                ? `${styles.pauseChip} ${styles.secondaryButtonActive}`
                : styles.pauseChip
            }
            aria-pressed={months === length}
            onClick={() => setMonths(length)}
          >
            {length === 1
              ? t('pauseCard.oneMonth')
              : t('pauseCard.nMonths', { count: length })}
          </button>
        ))}
      </div>

      {resumeDate && (
        <p className={styles.planDetail} role="status" aria-live="polite">
          {t('pauseCard.resumesLine', {
            date: formatDate(resumeDate),
            plan: planText,
          })}
        </p>
      )}

      <div className={sharedStyles.marginTopLg}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={months == null || isPausing}
          onClick={() => months != null && onPause(months)}
        >
          {isPausing
            ? t('pauseCard.pausing')
            : t('pauseCard.pauseSubscription')}
        </button>
      </div>

      {pauseError && <p className={styles.helpDanger}>{pauseError}</p>}
    </div>
  );
}
