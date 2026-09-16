import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { track } from '../../lib/analytics/track';
import {
  startCreditPackCheckout,
  StartCreditPackCheckoutOutcome,
} from '../../lib/backend/startCreditPackCheckout';
import sharedStyles from '../../styles/shared.module.css';
import styles from './BuyCreditsButton.module.css';

export type CreditPackSource =
  | 'credits_conversion'
  | 'credits_badge'
  | 'credits_account'
  | 'credits_chat';

interface Props {
  readonly source: CreditPackSource;
  readonly variant: 'link' | 'secondary';
  readonly compact?: boolean;
}

function resolveLabel(
  t: TFunction<'aicredits'>,
  pending: boolean,
  compact: boolean
): string {
  if (pending) return t('buyPending');
  if (compact) return t('buyShort');
  return t('buy');
}

export function BuyCreditsButton({ source, variant, compact = false }: Props) {
  const { t } = useTranslation('aicredits');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const onClick = async () => {
    if (pending) return;
    setFailed(false);
    setPending(true);
    track('credits_buy_clicked', { source });
    let outcome: StartCreditPackCheckoutOutcome = 'error';
    try {
      outcome = await startCreditPackCheckout(source);
    } catch {
      outcome = 'error';
    }
    if (outcome === 'redirecting') return;
    setPending(false);
    setFailed(true);
  };

  const className =
    variant === 'secondary'
      ? `${sharedStyles.btnSecondary} ${styles.secondary}`
      : styles.link;

  return (
    <span className={styles.wrapper}>
      <button
        type="button"
        className={className}
        onClick={onClick}
        disabled={pending}
      >
        {resolveLabel(t, pending, compact)}
      </button>
      {failed && (
        <span className={styles.error} role="alert">
          {t('buyError')}
        </span>
      )}
    </span>
  );
}
