import { useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { startUnlimitedUpgrade } from '../../lib/backend/startUnlimitedUpgrade';
import { PassCards } from '../PricingPage/components/PassCards';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import styles from './LimitPage.module.css';

const REF = 'limit-wall';

const ANONYMOUS_CARD_CAP = 21;
const FREE_MONTHLY_CARDS = 100;

function AnonymousLimit() {
  const { t } = useTranslation('accountx');

  useEffect(() => {
    track('paywall_shown', { surface: REF, variant: 'anonymous' });
  }, []);

  return (
    <div className={styles.page}>
      <Helmet>
        <title>{t('limit.helmetAnon')}</title>
      </Helmet>

      <header className={styles.header}>
        <p className={styles.statusLine}>
          {t('limit.statusLine', { count: ANONYMOUS_CARD_CAP })}
        </p>
        <h1 className={styles.heading}>{t('limit.anonHeading')}</h1>
        <p className={styles.subheading}>
          {t('limit.anonSubheading', {
            cap: ANONYMOUS_CARD_CAP,
            monthly: FREE_MONTHLY_CARDS,
          })}
        </p>
      </header>

      <div className={styles.singlePlan}>
        <div className={`${styles.planCard} ${styles.planCardFeatured}`}>
          <p className={styles.planTitle}>{t('limit.freeAccount')}</p>
          <ul className={styles.planBenefits}>
            <li className={styles.planBenefit}>
              {t('limit.freeBenefitCards', { monthly: FREE_MONTHLY_CARDS })}
            </li>
            <li className={styles.planBenefit}>{t('limit.saveRedownload')}</li>
            <li className={styles.planBenefit}>{t('limit.connectServices')}</li>
          </ul>
          <div className={styles.planCtas}>
            <Link
              to="/register?redirect=/upload"
              className={styles.planCtaPrimary}
              onClick={() =>
                track('paywall_upgrade_clicked', {
                  surface: REF,
                  plan: 'free_signup',
                })
              }
            >
              {t('limit.signUpFree')}
            </Link>
            <Link
              to="/login?redirect=/upload"
              className={styles.planCtaSecondary}
              onClick={() =>
                track('paywall_upgrade_clicked', {
                  surface: REF,
                  plan: 'sign_in',
                })
              }
            >
              {t('limit.signIn')}
            </Link>
          </div>
          <p className={styles.planNote}>{t('limit.browserNote')}</p>
        </div>
      </div>
    </div>
  );
}

export function LimitPage() {
  const { t } = useTranslation('accountx');
  const { data: userLocals, isLoading } = useUserLocals();
  const isLoggedIn = userLocals?.user?.id != null;
  const [dayPassPending, setDayPassPending] = useState(false);
  const [weekPassPending, setWeekPassPending] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);

  const showAnonymous = !isLoggedIn;

  useEffect(() => {
    if (isLoading || showAnonymous) return;
    track('paywall_shown', { surface: REF });
  }, [isLoading, showAnonymous]);

  if (isLoading) {
    return <div className={styles.page} aria-busy="true" />;
  }

  if (showAnonymous) {
    return <AnonymousLimit />;
  }

  const handlePassCheckout = async (passKind: '24h' | '7d') => {
    if (!isLoggedIn) {
      globalThis.location.href = `/login?redirect=/limit&ref=${REF}`;
      return;
    }
    track('paywall_upgrade_clicked', {
      surface: REF,
      plan: passKind === '24h' ? 'day_pass' : 'week_pass',
    });
    setPassError(null);
    if (passKind === '24h') {
      setDayPassPending(true);
    } else {
      setWeekPassPending(true);
    }
    try {
      const result = await get2ankiApi().startPassCheckout(
        passKind,
        undefined,
        REF
      );
      if ('url' in result) {
        globalThis.location.href = result.url;
        return;
      }
      setPassError(t('limit.checkoutError'));
    } finally {
      setDayPassPending(false);
      setWeekPassPending(false);
    }
  };

  const unlimitedLink = isLoggedIn
    ? `/pricing?source=${REF}`
    : `/login?redirect=/pricing&ref=${REF}`;

  const handleUnlimitedClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    track('paywall_upgrade_clicked', { surface: REF, plan: 'unlimited' });
    if (!isLoggedIn) {
      return;
    }
    event.preventDefault();
    await startUnlimitedUpgrade(REF);
  };

  return (
    <div className={styles.page}>
      <Helmet>
        <title>You reached your monthly limit | 2anki</title>
      </Helmet>

      <header className={styles.header}>
        <h1 className={styles.heading}>You reached 100 cards this month</h1>
        <p className={styles.subheading}>{t('limit.upgradeSubheading')}</p>
      </header>

      <p className={styles.sectionLabel}>{t('limit.payOnce')}</p>
      <PassCards
        onDayPass={() => handlePassCheckout('24h')}
        onWeekPass={() => handlePassCheckout('7d')}
        dayPassPending={dayPassPending}
        weekPassPending={weekPassPending}
        featureDayPass
      />
      {passError && (
        <p className={styles.planError} role="alert">
          {passError}
        </p>
      )}

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
            href={unlimitedLink}
            className={styles.planCtaSecondary}
            onClick={handleUnlimitedClick}
          >
            {t('limit.upgradeToUnlimited')}
          </a>
        </div>
      </div>

      <p className={styles.backLink}>
        <Link to="/upload">{t('limit.backToUpload')}</Link>
      </p>
    </div>
  );
}

export default LimitPage;
