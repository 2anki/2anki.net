import { useEffect, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { PassCards } from '../PricingPage/components/PassCards';
import styles from './LimitPage.module.css';

export const FREE_MONTHLY_CARDS = 100;

export type PassKind = '24h' | '7d' | '120d';
export type WallOrder = 'passes-first' | 'unlimited-first';

interface LimitWallProps {
  order: WallOrder;
  pendingPass: PassKind | null;
  onPass: (kind: PassKind) => void;
  passError: string | null;
  unlimitedHref: string;
  onUnlimitedClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export function LimitWall({
  order,
  pendingPass,
  onPass,
  passError,
  unlimitedHref,
  onUnlimitedClick,
}: Readonly<LimitWallProps>) {
  const { t } = useTranslation('accountx');
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (passError != null) {
      errorRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [passError]);

  const passes = (
    <>
      <p className={styles.sectionLabel}>{t('limit.payOnce')}</p>
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
        featureDayPass
      />
    </>
  );

  const unlimited = (
    <>
      <p className={styles.sectionLabel}>{t('limit.skipCap')}</p>
      <div className={styles.singlePlan}>
        <div className={styles.planCard}>
          <p className={styles.planTitle}>{t('limit.unlimited')}</p>
          <ul className={styles.planBenefits}>
            {[
              t('limit.benefitUnlimited'),
              t('limit.benefitMultiple'),
              t('limit.benefitPdf'),
              t('limit.benefitCancel'),
            ].map((b) => (
              <li key={b} className={styles.planBenefit}>
                {b}
              </li>
            ))}
          </ul>
          <a
            href={unlimitedHref}
            className={styles.planCtaSecondary}
            onClick={onUnlimitedClick}
          >
            {t('limit.upgradeToUnlimited')}
          </a>
        </div>
      </div>
    </>
  );

  return (
    <div className={styles.page}>
      <Helmet>
        <title>{t('limit.pageTitle')}</title>
      </Helmet>

      <header className={styles.header}>
        <h1 className={styles.heading}>
          {t('limit.headline', { limit: FREE_MONTHLY_CARDS })}
        </h1>
        <p className={styles.subheading}>{t('limit.upgradeSubheading')}</p>
      </header>

      {order === 'passes-first' ? (
        <>
          {passes}
          {unlimited}
        </>
      ) : (
        <>
          {unlimited}
          {passes}
        </>
      )}

      <p className={styles.backLink}>
        <Link to="/upload">{t('limit.backToUpload')}</Link>
      </p>
    </div>
  );
}
