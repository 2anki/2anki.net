import { useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { purchaseConflictMessage } from '../../lib/checkout/purchaseConflictMessage';
import { startUnlimitedUpgrade } from '../../lib/backend/startUnlimitedUpgrade';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { AnonymousDayPassOffer } from '../../components/AnonymousDayPassOffer/AnonymousDayPassOffer';
import { deckCardsBucket } from './deckCardsBucket';
import {
  ANONYMOUS_CARD_CAP,
  FREE_MONTHLY_CARDS,
  LimitWall,
  type PassKind,
  type WallOrder,
} from './LimitWall';
import styles from './LimitPage.module.css';

function parseTotalCards(raw: string | null): number | null {
  if (raw == null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const REF = 'limit-wall';

const WALL_ORDER: WallOrder = 'unlimited-first';

const PASS_PLAN: Record<PassKind, string> = {
  '24h': 'day_pass',
  '7d': 'week_pass',
  '120d': 'semester_pass',
};

// Same vocabulary as the downloads-page pass CTA, so one query reads both.
const PASS_CLICK_PLAN: Record<PassKind, string> = {
  '24h': 'day',
  '7d': 'week',
  '120d': 'semester',
};

type Translate = ReturnType<typeof useTranslation>['t'];

function FreeAccountCard({ t, featured }: { t: Translate; featured: boolean }) {
  return (
    <div
      className={`${styles.planCard} ${featured ? styles.planCardFeatured : ''}`}
    >
      <p className={styles.planTitle}>{t('limit.freeAccount')}</p>
      <p className={styles.planSubtitle}>
        {t('limit.freeSubtitle', { monthly: FREE_MONTHLY_CARDS })}
      </p>
      <ul className={styles.planBenefits}>
        <li className={styles.planBenefit}>{t('limit.saveRedownload')}</li>
        <li className={styles.planBenefit}>{t('limit.connectServices')}</li>
      </ul>
      <div className={styles.planCtas}>
        <Link
          to="/register?redirect=/upload"
          className={featured ? styles.planCtaPrimary : styles.planCtaSecondary}
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
          className={featured ? styles.planCtaSecondary : styles.signInLink}
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
  );
}

function DayPassCard({ totalCards }: { totalCards: number }) {
  const overMonth = totalCards > FREE_MONTHLY_CARDS;
  return (
    <div
      className={`${styles.planCard} ${overMonth ? styles.planCardFeatured : ''}`}
    >
      <AnonymousDayPassOffer
        surface="anonymous-limit-wall"
        totalCards={totalCards}
        dayPassCard
        emphasis={overMonth ? 'primary' : 'secondary'}
      />
    </div>
  );
}

function AnonymousLimitCards({ totalCards }: { totalCards: number }) {
  const { t } = useTranslation('accountx');
  const overMonth = totalCards > FREE_MONTHLY_CARDS;
  const freeCard = <FreeAccountCard t={t} featured={!overMonth} />;
  const dayPassCard = <DayPassCard totalCards={totalCards} />;
  return (
    <div className={styles.plans}>
      {overMonth ? (
        <>
          {dayPassCard}
          {freeCard}
        </>
      ) : (
        <>
          {freeCard}
          {dayPassCard}
        </>
      )}
    </div>
  );
}

function AnonymousLimit() {
  const { t } = useTranslation('accountx');
  const [searchParams] = useSearchParams();
  const totalCards = parseTotalCards(searchParams.get('cards'));

  useEffect(() => {
    track('paywall_shown', {
      surface: REF,
      variant: 'anonymous',
      ...(totalCards != null
        ? { deck_cards: deckCardsBucket(totalCards) }
        : {}),
    });
  }, [totalCards]);

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

      {totalCards != null ? (
        <AnonymousLimitCards totalCards={totalCards} />
      ) : (
        <div className={styles.singlePlan}>
          <div className={`${styles.planCard} ${styles.planCardFeatured}`}>
            <p className={styles.planTitle}>{t('limit.freeAccount')}</p>
            <ul className={styles.planBenefits}>
              <li className={styles.planBenefit}>
                {t('limit.freeBenefitCards', { monthly: FREE_MONTHLY_CARDS })}
              </li>
              <li className={styles.planBenefit}>
                {t('limit.saveRedownload')}
              </li>
              <li className={styles.planBenefit}>
                {t('limit.connectServices')}
              </li>
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
            <AnonymousDayPassOffer surface="anonymous-limit-wall" />
          </div>
        </div>
      )}
    </div>
  );
}

export function LimitPage() {
  const { t, i18n } = useTranslation('accountx');
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
    track('paywall_pass_clicked', {
      surface: REF,
      plan: PASS_CLICK_PLAN[passKind],
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
      if (result.status === 'conflict') {
        setPassError(purchaseConflictMessage(t, result, i18n.language));
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
