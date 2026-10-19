import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { usePassPrices } from '../../lib/hooks/usePassPrices';
import styles from './AnonymousDayPassOffer.module.css';

interface Props {
  readonly surface: string;
  readonly totalCards?: number;
}

export function AnonymousDayPassOffer({ surface, totalCards }: Props) {
  const { t } = useTranslation('anonymousPass');
  const prices = usePassPrices();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buy = async () => {
    track('paywall_pass_clicked', {
      surface,
      plan: 'day',
      variant: 'anonymous',
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
