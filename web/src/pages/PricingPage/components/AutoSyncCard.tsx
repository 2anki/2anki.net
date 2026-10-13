import { useTranslation } from 'react-i18next';
import styles from '../PricingPage.module.css';

export type AutoSyncCardState =
  | 'buy'
  | 'switch'
  | 'active'
  | 'full'
  | 'unavailable'
  | 'error';

interface AutoSyncCardProps {
  price: string;
  interval: string;
  state: AutoSyncCardState;
  pending: boolean;
  onBuy: () => void;
}

const BENEFIT_KEYS = [
  'autosync:benefitPro',
  'autosync:benefitSync',
  'autosync:benefitDevices',
  'autosync:benefitCancel',
];

const CAPTION_KEYS: Partial<Record<AutoSyncCardState, string>> = {
  switch: 'autosync:switchNote',
  full: 'autosync:capReached',
  unavailable: 'autosync:upgradeUnavailable',
  error: 'autosync:error',
};

function CheckIcon() {
  return (
    <svg
      className={styles.benefitIcon}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3.5 8.5l3 3 6-6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AutoSyncCard({
  price,
  interval,
  state,
  pending,
  onBuy,
}: Readonly<AutoSyncCardProps>) {
  const { t } = useTranslation();
  const captionKey = CAPTION_KEYS[state];

  function action() {
    if (state === 'active') {
      return (
        <a className={styles.cardButton} href="/ankify">
          {t('autosync:activeCta')}
        </a>
      );
    }
    let label = t('autosync:cta');
    if (pending) label = t('autosync:pending');
    else if (state === 'switch') label = t('autosync:ctaSwitch');
    return (
      <button
        type="button"
        className={styles.cardButton}
        onClick={onBuy}
        disabled={pending || state === 'full' || state === 'unavailable'}
      >
        {label}
      </button>
    );
  }

  return (
    <div id="auto-sync" className={styles.card} data-testid="auto-sync-card">
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>Auto Sync</h3>
        <span className={styles.cardPriceLine}>
          <span className={styles.cardPrice}>{price}</span>
          <span className={styles.cardPriceSuffix}>
            {interval === 'year'
              ? t('autosync:perYear')
              : t('autosync:perMonth')}
          </span>
        </span>
        {state === 'active' && (
          <p className={styles.yearlyHint}>{t('autosync:activeTitle')}</p>
        )}
      </div>
      <div className={styles.cardBody}>
        {BENEFIT_KEYS.map((key) => (
          <p key={key} className={styles.benefit}>
            <CheckIcon />
            <span>{t(key)}</span>
          </p>
        ))}
      </div>
      <div className={styles.cardFooter}>
        {action()}
        {captionKey != null && (
          <p
            className={styles.cardCaption}
            role={state === 'error' ? 'alert' : undefined}
          >
            {t(captionKey)}
          </p>
        )}
        <p className={styles.cardCaption}>
          <a href="/documentation/sync/how-it-works">
            {t('autosync:learnMore')}
          </a>
        </p>
      </div>
    </div>
  );
}
