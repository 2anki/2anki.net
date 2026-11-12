import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';
import { get2ankiApi } from '../../../lib/backend/get2ankiApi';
import { purchaseConflictMessage } from '../../../lib/checkout/purchaseConflictMessage';
import { useLivePassPrices } from '../../../lib/hooks/usePassPrices';
import { formatLongDate } from '../utils/formatLongDate';
import { semesterRenewalDaysLeft } from '../utils/semesterRenewalWindow';
import accountStyles from '../AccountPage.module.css';
import styles from './SemesterRenewalBanner.module.css';

const SURFACE = 'semester-renewal';

interface SemesterRenewalBannerProps {
  readonly passKind: '24h' | '7d' | '120d' | 'unlimited' | null | undefined;
  readonly passExpiresAt: string | null | undefined;
  readonly now?: Date;
}

export function SemesterRenewalBanner({
  passKind,
  passExpiresAt,
  now,
}: SemesterRenewalBannerProps) {
  const [mountedAt] = useState(() => new Date());
  const { t, i18n } = useTranslation('semesterRenewal');
  const prices = useLivePassPrices();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownRef = useRef(false);
  const daysLeft = semesterRenewalDaysLeft(
    passKind,
    passExpiresAt,
    now ?? mountedAt
  );

  useEffect(() => {
    if (daysLeft == null || shownRef.current) return;
    shownRef.current = true;
    track('semester_renewal_banner_shown', { days_left: daysLeft });
  }, [daysLeft]);

  if (daysLeft == null || passExpiresAt == null) {
    return null;
  }

  const date = formatLongDate(new Date(passExpiresAt), i18n.language);
  const price = prices['120d'];

  const renew = async () => {
    track('semester_renewal_clicked', { days_left: daysLeft });
    setError(null);
    setPending(true);
    try {
      const result = await get2ankiApi().startPassCheckout(
        '120d',
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
    }
    setPending(false);
  };

  return (
    <section
      className={`${accountStyles.section} ${styles.banner}`}
      aria-label={t('aria')}
    >
      <p className={styles.title}>{t('title', { date })}</p>
      <p className={styles.body}>{t('body', { date })}</p>
      {error && (
        <p className={accountStyles.helpDanger} role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={accountStyles.primaryButton}
        disabled={pending}
        onClick={() => void renew()}
      >
        {pending && t('opening')}
        {!pending && price != null && t('renewWithPrice', { price })}
        {!pending && price == null && t('renew')}
      </button>
    </section>
  );
}
