import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RegisterForm from '../forms/RegisterForm';
import { AnonymousDayPassOffer } from '../AnonymousDayPassOffer/AnonymousDayPassOffer';
import { FREE_MONTHLY_CARDS } from '../../pages/LimitPage/LimitWall';
import { track } from '../../lib/analytics/track';
import type { HeldDeckState } from '../../pages/UploadPage/components/UploadForm/hooks/useUploadFormState';
import styles from './AnonymousPartialGate.module.css';

interface Props {
  readonly held: HeldDeckState;
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error != null && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

function LockIcon() {
  return (
    <span className={styles.icon} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        width="36"
        height="36"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </span>
  );
}

export function AnonymousPartialGate({ held }: Props) {
  const { t } = useTranslation('anonymousPartial');
  const shownRef = useRef(false);
  const [error, setError] = useState('');
  const fitsFreeMonth = held.totalCards <= FREE_MONTHLY_CARDS;
  const leadWithDayPass = held.dayPassCard === true;

  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    track('anonymous_partial_gate_shown', {
      cards_held_back: held.cardsHeldBack,
    });
  }, [held.cardsHeldBack]);

  const registerForm = (
    <div className={styles.form}>
      <RegisterForm
        variant="inline"
        redirect="/upload"
        setErrorMessage={(e) => setError(errorText(e))}
      />
    </div>
  );

  const errorMessage = error && (
    <p className={styles.error} role="alert">
      {error}
    </p>
  );

  if (leadWithDayPass) {
    return (
      <section className={styles.gate} aria-label={t('gateAria')}>
        <LockIcon />
        <p className={styles.headline}>
          {t('gateHeadlineCappedTotal', { total: held.totalCards })}
        </p>
        {errorMessage}
        <div className={styles.leadCard}>
          <AnonymousDayPassOffer
            surface="anonymous-gate"
            totalCards={held.totalCards}
            dayPassCard
            emphasis="primary"
          />
        </div>
        <p className={styles.leadIn}>
          {t('gateFreeLeadIn', { monthly: FREE_MONTHLY_CARDS })}
        </p>
        {registerForm}
      </section>
    );
  }

  return (
    <section className={styles.gate} aria-label={t('gateAria')}>
      <LockIcon />
      <p className={styles.headline}>
        {fitsFreeMonth
          ? t('gateHeadlineAll', { total: held.totalCards })
          : t('gateHeadlineCapped', { monthly: FREE_MONTHLY_CARDS })}
      </p>
      <p className={styles.body}>
        {t('gateBody', { monthly: FREE_MONTHLY_CARDS })}
      </p>
      {!fitsFreeMonth && (
        <p className={styles.context}>
          {t('gateContext', { total: held.totalCards })}
        </p>
      )}
      {errorMessage}
      {registerForm}
      <AnonymousDayPassOffer
        surface="anonymous-gate"
        totalCards={held.totalCards}
      />
    </section>
  );
}

export default AnonymousPartialGate;
