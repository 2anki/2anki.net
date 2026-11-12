import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
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

const formatOfferEnd = (iso: string, locale: string): string =>
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

  return (
    <section className={styles.offer} aria-labelledby="day-pass-credit-title">
      <p id="day-pass-credit-title" className={styles.title}>
        {t('title', { price: offer.display })}
      </p>
      <p className={styles.body}>
        {t('body', {
          dayPassPrice: offer.dayPassDisplay,
          semesterPrice: offer.semesterDisplay,
          date: formatOfferEnd(offer.endsAt, i18n.language),
        })}
      </p>
      {refusal !== 'unavailable' && (
        <button
          type="button"
          className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
          onClick={handleClick}
          disabled={pending}
        >
          {pending ? t('pending') : t('cta', { price: offer.display })}
        </button>
      )}
      {refusal != null && (
        <p role="alert" className={styles.refusal}>
          {t(refusal)}
        </p>
      )}
    </section>
  );
}
