import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import RegisterForm from '../forms/RegisterForm';
import { AnonymousDayPassOffer } from '../AnonymousDayPassOffer/AnonymousDayPassOffer';
import { PassFirstOffer } from '../PassFirstOffer/PassFirstOffer';
import {
  ANONYMOUS_CARD_CAP,
  FREE_MONTHLY_CARDS,
} from '../../pages/LimitPage/LimitWall';
import { track } from '../../lib/analytics/track';
import type { HeldDeckState } from '../../pages/UploadPage/components/UploadForm/hooks/useUploadFormState';
import styles from './AnonymousPartialGate.module.css';

// The server releases a held deck only for a pass bought under this surface
// (HELD_DECK_CHECKOUT_SURFACE in ClaimHeldDeckWithPassUseCase).
export const HELD_DECK_CHECKOUT_SURFACE = 'anonymous-gate';
const SURFACE = HELD_DECK_CHECKOUT_SURFACE;

interface Props {
  readonly held: HeldDeckState;
  readonly passFirst?: boolean;
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

function hasAnonIdCookie(): boolean {
  return document.cookie.split(';').some((pair) => {
    const [name, value] = pair.trim().split('=');
    return name === 'anon_id' && value != null && value.length > 0;
  });
}

function ReadyIcon() {
  return (
    <span className={styles.readyIcon} aria-hidden="true">
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
        <circle cx="12" cy="12" r="10" />
        <path d="m8 12 3 3 5-6" />
      </svg>
    </span>
  );
}

function HeldDeckSummary({
  held,
  cookieLost,
}: {
  readonly held: HeldDeckState;
  readonly cookieLost: boolean;
}) {
  const { t } = useTranslation('anonymousPartial');
  return (
    <>
      <ReadyIcon />
      <p className={styles.deckName} data-hj-suppress>
        {held.deckName ?? t('untitledDeck')}
      </p>
      <p className={styles.headline}>
        {t('gateHeadlineAll', { total: held.totalCards })}
      </p>
      {cookieLost && <p className={styles.cookieLost}>{t('gateCookieLost')}</p>}
      {!cookieLost && held.savedForHours != null && (
        <p className={styles.saved}>
          {t('gateSaved', { count: held.savedForHours })}
        </p>
      )}
    </>
  );
}

function FreeSignupLink({ monthly }: { readonly monthly: number }) {
  const { t } = useTranslation('anonymousPartial');
  return (
    <p className={styles.freeLink}>
      <Link
        to="/register?redirect=/upload"
        onClick={() =>
          track('paywall_upgrade_clicked', {
            surface: SURFACE,
            plan: 'free_signup',
          })
        }
      >
        {t('gateFreeLink', { monthly })}
      </Link>
    </p>
  );
}

// Pass-first: the passes lead and a free account (the 21-card preview) is a
// text link. The held deck stays saved, so signing up still claims it.
function PassFirstGate({
  held,
  cookieLost,
}: {
  readonly held: HeldDeckState;
  readonly cookieLost: boolean;
}) {
  const { t } = useTranslation('passFirst');
  const { t: tPartial } = useTranslation('anonymousPartial');
  return (
    <div className={styles.gate}>
      <LockIcon />
      {cookieLost && (
        <p className={styles.cookieLost}>{tPartial('gateCookieLost')}</p>
      )}
      <PassFirstOffer
        surface={SURFACE}
        headline={t('readyTotal', { total: held.totalCards })}
        body={
          cookieLost
            ? t('afterPayRedropTotal', { total: held.totalCards })
            : t('gateBody', { cap: ANONYMOUS_CARD_CAP })
        }
      >
        <Link
          to="/register?redirect=/upload"
          onClick={() =>
            track('paywall_upgrade_clicked', {
              surface: SURFACE,
              plan: 'free_signup',
            })
          }
        >
          {t('freeSignupCap', { cap: ANONYMOUS_CARD_CAP })}
        </Link>
        <Link
          to="/login?redirect=/upload"
          onClick={() =>
            track('paywall_upgrade_clicked', {
              surface: SURFACE,
              plan: 'sign_in',
            })
          }
        >
          {t('signIn')}
        </Link>
      </PassFirstOffer>
    </div>
  );
}

export function AnonymousPartialGate({ held, passFirst = false }: Props) {
  const { t } = useTranslation('anonymousPartial');
  const shownRef = useRef(false);
  const [error, setError] = useState('');
  const fitsFreeMonth = held.totalCards <= FREE_MONTHLY_CARDS;
  const leadWithDayPass = held.dayPassCard === true;
  const [cookieLost] = useState(
    () => held.cookieMinted === true && !hasAnonIdCookie()
  );

  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    track('anonymous_partial_gate_shown', {
      cards_held_back: held.cardsHeldBack,
      ...(cookieLost ? { cookie_lost: true } : {}),
    });
  }, [held.cardsHeldBack, cookieLost]);

  if (passFirst) {
    return <PassFirstGate held={held} cookieLost={cookieLost} />;
  }

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
        <HeldDeckSummary held={held} cookieLost={cookieLost} />
        {errorMessage}
        <div className={styles.leadCard}>
          <AnonymousDayPassOffer
            surface={SURFACE}
            totalCards={held.totalCards}
            dayPassCard
            held={!cookieLost}
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

  const dayPassOffer = (
    <AnonymousDayPassOffer
      surface={SURFACE}
      totalCards={held.totalCards}
      held={!cookieLost}
    />
  );

  return (
    <section className={styles.gate} aria-label={t('gateAria')}>
      <HeldDeckSummary held={held} cookieLost={cookieLost} />
      {fitsFreeMonth ? (
        <>
          {!cookieLost && (
            <p className={styles.body}>
              {t('gateBody', { monthly: FREE_MONTHLY_CARDS })}
            </p>
          )}
          {errorMessage}
          {registerForm}
          {dayPassOffer}
        </>
      ) : (
        <>
          {dayPassOffer}
          <FreeSignupLink monthly={FREE_MONTHLY_CARDS} />
        </>
      )}
    </section>
  );
}

export default AnonymousPartialGate;
