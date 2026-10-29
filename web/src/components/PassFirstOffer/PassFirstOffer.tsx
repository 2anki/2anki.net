import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { purchaseConflictMessage } from '../../lib/checkout/purchaseConflictMessage';
import { usePassPrices } from '../../lib/hooks/usePassPrices';
import styles from './PassFirstOffer.module.css';

type PassKind = '24h' | '120d';

// Same vocabularies the limit wall already reports, so one query reads both.
const UPGRADE_PLAN: Record<PassKind, string> = {
  '24h': 'day_pass',
  '120d': 'semester_pass',
};

const PASS_CLICK_PLAN: Record<PassKind, string> = {
  '24h': 'day',
  '120d': 'semester',
};

interface PassFirstOfferProps {
  readonly surface: string;
  readonly headline?: string;
  readonly body?: string;
  readonly note?: string;
  // Free sign-up, sign-in or a plans link, rendered as plain text links below
  // the passes.
  readonly children?: ReactNode;
}

// The pass-first limit wall: the Semester Pass leads, the Day Pass sits beside
// it, and anything free drops to a text link underneath.
export function PassFirstOffer({
  surface,
  headline,
  body,
  note,
  children,
}: PassFirstOfferProps) {
  const { t, i18n } = useTranslation('passFirst');
  const prices = usePassPrices();
  const [pending, setPending] = useState<PassKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buy = async (kind: PassKind) => {
    track('paywall_upgrade_clicked', { surface, plan: UPGRADE_PLAN[kind] });
    track('paywall_pass_clicked', { surface, plan: PASS_CLICK_PLAN[kind] });
    setError(null);
    setPending(kind);
    try {
      const result = await get2ankiApi().startPassCheckout(
        kind,
        undefined,
        surface
      );
      if ('url' in result) {
        // Leaving for Stripe: keep the buttons disabled until the page goes.
        globalThis.location.href = result.url;
        return;
      }
      setError(
        result.status === 'conflict'
          ? purchaseConflictMessage(t, result, i18n.language)
          : t('checkoutError')
      );
    } catch {
      setError(t('checkoutError'));
    }
    setPending(null);
  };

  return (
    <section className={styles.offer} aria-label={t('aria')}>
      {headline && <p className={styles.headline}>{headline}</p>}
      {body && <p className={styles.body}>{body}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.plans}>
        <button
          type="button"
          className={styles.primary}
          disabled={pending != null}
          onClick={() => void buy('120d')}
        >
          <span className={styles.planLabel}>
            {pending === '120d'
              ? t('starting')
              : t('semester', { price: prices['120d'] })}
          </span>
          <span className={styles.planHint}>{t('semesterHint')}</span>
          <span className={styles.planBadge}>
            {t('common:pricing.pass.bestValue')}
          </span>
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={pending != null}
          onClick={() => void buy('24h')}
        >
          <span className={styles.planLabel}>
            {pending === '24h'
              ? t('starting')
              : t('day', { price: prices['24h'] })}
          </span>
          <span className={styles.planHint}>{t('dayHint')}</span>
          <span className={styles.planBadge}>
            {t('common:pricing.pass.mostPopular')}
          </span>
        </button>
      </div>
      {note && <p className={styles.note}>{note}</p>}
      {children != null && <p className={styles.links}>{children}</p>}
    </section>
  );
}

export default PassFirstOffer;
