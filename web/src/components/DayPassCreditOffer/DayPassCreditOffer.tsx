import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { track } from '../../lib/analytics/track';
import {
  getDayPassCreditOffer,
  startDayPassCreditCheckout,
} from '../../lib/backend/dayPassCredit';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import sharedStyles from '../../styles/shared.module.css';
import styles from './DayPassCreditOffer.module.css';

export type DayPassCreditPlacement = 'account' | 'upload';

interface DayPassCreditOfferProps {
  readonly placement: DayPassCreditPlacement;
  readonly enabled: boolean;
}

const formatDateTime = (iso: string, locale: string): string =>
  new Date(iso).toLocaleString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export function DayPassCreditOffer({
  placement,
  enabled,
}: DayPassCreditOfferProps) {
  const { t, i18n } = useTranslation('dayPassCredit');
  const { data: userLocals } = useUserLocals();
  const { data: offer } = useQuery({
    queryKey: ['dayPassCredit', userLocals?.user?.id ?? null],
    queryFn: getDayPassCreditOffer,
    enabled,
    staleTime: 60_000,
  });
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<'unavailable' | 'error' | null>(null);
  const shownTracked = useRef(false);

  const visible = enabled && offer != null;

  useEffect(() => {
    if (!visible || shownTracked.current) return;
    shownTracked.current = true;
    track('day_pass_credit_offer_shown', { placement });
  }, [visible, placement]);

  if (!enabled || offer == null) return null;

  const handleClick = async () => {
    track('day_pass_credit_offer_clicked', { placement });
    setPending(true);
    setRefusal(null);
    const result = await startDayPassCreditCheckout();
    if ('url' in result) {
      globalThis.location.href = result.url;
      return;
    }
    setPending(false);
    setRefusal(result.status);
  };

  if (refusal === 'unavailable') {
    return (
      <section className={styles.offer}>
        <p role="alert" className={styles.refusal}>
          {t('unavailable')} <Link to="/pricing">{t('seePlans')}</Link>
        </p>
      </section>
    );
  }

  const startLine =
    offer.semesterStartsAt == null
      ? t('startsNow')
      : t('startsLater', {
          date: formatDateTime(offer.semesterStartsAt, i18n.language),
        });

  return (
    <section className={styles.offer} aria-labelledby="day-pass-credit-title">
      <p id="day-pass-credit-title" className={styles.title}>
        {t('title', { price: offer.display })}
      </p>
      <p className={styles.body}>
        {t('body', {
          dayPassPrice: offer.dayPassDisplay,
          semesterPrice: offer.semesterDisplay,
        })}
      </p>
      <p className={styles.body}>{startLine}</p>
      <p className={styles.body}>
        {t('offerEnds', {
          date: formatDateTime(offer.endsAt, i18n.language),
        })}
      </p>
      <button
        type="button"
        className={sharedStyles.btnSecondary}
        onClick={handleClick}
        disabled={pending}
      >
        {pending ? t('pending') : t('cta', { price: offer.display })}
      </button>
      {refusal === 'error' && (
        <p role="alert" className={styles.refusal}>
          {t('error')}
        </p>
      )}
    </section>
  );
}
