import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  PASS_BENEFIT_KEYS,
  PassCards,
} from '../PricingPage/components/PassCards';
import type { PassPriceDisplay } from '../../lib/hooks/usePassPrices';
import styles from './LimitPage.module.css';

export const FREE_MONTHLY_CARDS = 100;
export const ANONYMOUS_CARD_CAP = 21;

export type PassKind = '24h' | '7d' | '120d';

const SHARED_PASS_BENEFIT_KEYS = PASS_BENEFIT_KEYS.filter(
  (key) => key !== 'pricing.pass.noSubscription'
);

interface LimitWallProps {
  pendingPass: PassKind | null;
  onPass: (kind: PassKind) => void;
  passError: string | null;
  unlimitedHref: string;
  unlimitedPrice?: string;
  onUnlimitedClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  notice?: ReactNode;
  featureSemester?: boolean;
  passPrices?: PassPriceDisplay;
}

export function LimitWall({
  pendingPass,
  onPass,
  passError,
  unlimitedHref,
  unlimitedPrice,
  onUnlimitedClick,
  notice,
  featureSemester = false,
  passPrices,
}: Readonly<LimitWallProps>) {
  const { t } = useTranslation('accountx');
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (passError != null) {
      errorRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [passError]);

  return (
    <div className={styles.page}>
      <Helmet>
        <title>{t('limit.pageTitle')}</title>
      </Helmet>

      <header className={styles.header}>
        <h1 className={styles.heading}>{t('limit.headline')}</h1>
        <p className={styles.subheading}>
          {t('limit.subheading', { limit: FREE_MONTHLY_CARDS })}
        </p>
      </header>

      {notice}

      <p className={styles.sectionLabel}>{t('limit.payOnce')}</p>
      <ul
        className={styles.sharedBenefits}
        aria-label={t('limit.passIncludes')}
      >
        {SHARED_PASS_BENEFIT_KEYS.map((key) => (
          <li key={key} className={styles.sharedBenefit}>
            {t(`common:${key}`)}
          </li>
        ))}
      </ul>
      {passError && (
        <p ref={errorRef} className={styles.planError} role="alert">
          {passError}
        </p>
      )}
      <PassCards
        onDayPass={() => onPass('24h')}
        onWeekPass={() => onPass('7d')}
        onSemesterPass={() => onPass('120d')}
        dayPassPending={pendingPass === '24h'}
        weekPassPending={pendingPass === '7d'}
        semesterPassPending={pendingPass === '120d'}
        featureDayPass={!featureSemester}
        featureSemester={featureSemester}
        benefits={[]}
        prices={passPrices}
      />

      <p className={styles.proLine}>
        <span>
          {unlimitedPrice == null
            ? t('limit.proLineNoPrice')
            : t('limit.proLine', { price: unlimitedPrice })}
        </span>{' '}
        <a href={unlimitedHref} onClick={onUnlimitedClick}>
          {t('limit.upgradeToUnlimited')}
        </a>
      </p>

      <p className={styles.backLink}>
        <Link to="/upload">{t('limit.backToUpload')}</Link>
      </p>
    </div>
  );
}
