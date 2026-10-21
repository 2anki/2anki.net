import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { usePassPrices } from '../../lib/hooks/usePassPrices';
import { FREE_MONTHLY_CARDS } from '../../pages/LimitPage/LimitWall';
import styles from './AnonymousDayPassOffer.module.css';

interface Props {
  readonly surface: string;
  readonly totalCards?: number;
  readonly dayPassCard?: boolean;
  readonly emphasis?: 'primary' | 'secondary';
}

export function AnonymousDayPassOffer({
  surface,
  totalCards,
  dayPassCard = false,
  emphasis = 'secondary',
}: Props) {
  const { t } = useTranslation('anonymousPass');
  const prices = usePassPrices();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buy = async () => {
    track('paywall_pass_clicked', {
      surface,
      plan: 'day',
      variant: dayPassCard ? 'card' : 'anonymous',
    });
    setError(null);
    setPending(true);
    try {
      const result = await get2ankiApi().startPassCheckout(
        '24h',
        undefined,
        surface
      );
      if ('url' in result) {
        globalThis.location.href = result.url;
        return;
      }
      setError(t('checkoutError'));
    } catch {
      setError(t('checkoutError'));
    } finally {
      setPending(false);
    }
  };

  if (dayPassCard) {
    const overMonth = totalCards != null && totalCards > FREE_MONTHLY_CARDS;
    const buttonClass =
      emphasis === 'primary' ? styles.buttonPrimary : styles.buttonSecondary;
    const idleLabel =
      totalCards == null
        ? t('cardCtaEvery')
        : t('cardCtaTotal', { total: totalCards });
    return (
      <div className={styles.card}>
        <div className={styles.cardTop}>
          <p className={styles.cardTitle}>{t('cardTitle')}</p>
          <p className={styles.cardBody}>
            {overMonth
              ? t('reason', { total: totalCards, monthly: FREE_MONTHLY_CARDS })
              : t('cardLine')}
          </p>
        </div>
        <div className={styles.cardBottom}>
          <p className={styles.cardPrice}>
            {t('cardPrice', { price: prices['24h'] })}
          </p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className={buttonClass}
            disabled={pending}
            onClick={() => void buy()}
          >
            {pending ? t('starting') : idleLabel}
          </button>
          <p className={styles.cardNote}>
            {totalCards == null
              ? t('afterPay')
              : t('afterPayTotal', { total: totalCards })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.offer}>
      <p className={styles.headline}>{t('headline')}</p>
      <p className={styles.body}>
        {t('body', { price: prices['24h'] })}{' '}
        {totalCards == null
          ? t('afterPay')
          : t('afterPayTotal', { total: totalCards })}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={styles.button}
        disabled={pending}
        onClick={() => void buy()}
      >
        {pending ? t('starting') : t('cta', { price: prices['24h'] })}
      </button>
    </div>
  );
}

export default AnonymousDayPassOffer;
