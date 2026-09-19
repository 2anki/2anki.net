import { useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { startUnlimitedUpgrade } from '../../lib/backend/startUnlimitedUpgrade';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import {
  FREE_MONTHLY_CARDS,
  LimitWall,
  type PassKind,
  type WallOrder,
} from './LimitWall';
import styles from './LimitPage.module.css';

const REF = 'limit-wall';

const ANONYMOUS_CARD_CAP = 21;

const WALL_ORDER: WallOrder = 'passes-first';

const PASS_PLAN: Record<PassKind, string> = {
  '24h': 'day_pass',
  '7d': 'week_pass',
  '120d': 'semester_pass',
};

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
  const [pendingPass, setPendingPass] = useState<PassKind | null>(null);
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

  const handlePassCheckout = async (passKind: PassKind) => {
    if (!isLoggedIn) {
      globalThis.location.href = `/login?redirect=/limit&ref=${REF}`;
      return;
    }
    track('paywall_upgrade_clicked', {
      surface: REF,
      plan: PASS_PLAN[passKind],
    });
    setPassError(null);
    setPendingPass(passKind);
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
      setPendingPass(null);
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
    <LimitWall
      order={WALL_ORDER}
      pendingPass={pendingPass}
      onPass={handlePassCheckout}
      passError={passError}
      unlimitedHref={unlimitedLink}
      onUnlimitedClick={handleUnlimitedClick}
    />
  );
}

export default LimitPage;
