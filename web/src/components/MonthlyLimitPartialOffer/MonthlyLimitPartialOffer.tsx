import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { startUnlimitedUpgrade } from '../../lib/backend/startUnlimitedUpgrade';
import { purchaseConflictMessage } from '../../lib/checkout/purchaseConflictMessage';
import { usePassPrices } from '../../lib/hooks/usePassPrices';
import { FREE_MONTHLY_CARDS } from '../../pages/LimitPage/LimitWall';
import styles from './MonthlyLimitPartialOffer.module.css';

const SURFACE = 'upload-partial';

type PassKind = '24h' | '120d';

const PASS_PLAN: Record<PassKind, string> = {
  '24h': 'day_pass',
  '120d': 'semester_pass',
};

interface MonthlyLimitPartialOfferProps {
  readonly delivered: number;
  readonly heldBack: number;
  readonly saved: boolean;
}

export function MonthlyLimitPartialOffer({
  delivered,
  heldBack,
  saved,
}: MonthlyLimitPartialOfferProps) {
  const { t, i18n } = useTranslation('monthlyPartial');
  const prices = usePassPrices();
  const [pending, setPending] = useState<PassKind | 'pro' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownRef = useRef(false);
  const total = delivered + heldBack;

  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    track('monthly_partial_offer_shown', {
      cards_held_back: heldBack,
      saved,
    });
  }, [heldBack, saved]);

  const buyPass = async (kind: PassKind) => {
    track('paywall_upgrade_clicked', {
      surface: SURFACE,
      plan: PASS_PLAN[kind],
    });
    setError(null);
    setPending(kind);
    try {
      const result = await get2ankiApi().startPassCheckout(
        kind,
        undefined,
        SURFACE
      );
      if ('url' in result) {
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
    } finally {
      setPending(null);
    }
  };

  const goPro = async () => {
    track('paywall_upgrade_clicked', { surface: SURFACE, plan: 'unlimited' });
    setPending('pro');
    await startUnlimitedUpgrade(SURFACE);
  };

  return (
    <section className={styles.card} aria-label={t('aria')}>
      <p className={styles.headline}>{t('headline', { delivered, total })}</p>
      <p className={styles.body}>
        {saved
          ? t('bodySaved', { count: heldBack, monthly: FREE_MONTHLY_CARDS })
          : t('bodyNotSaved', { total, monthly: FREE_MONTHLY_CARDS })}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={pending != null}
          onClick={() => void buyPass('24h')}
        >
          {t('dayPass', { price: prices['24h'] })}
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={pending != null}
          onClick={() => void buyPass('120d')}
        >
          {t('semesterPass', { price: prices['120d'] })}
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={pending != null}
          onClick={() => void goPro()}
        >
          {t('pro')}
        </button>
      </div>
    </section>
  );
}

export default MonthlyLimitPartialOffer;
