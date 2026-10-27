import { useEffect, useState, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { purchaseConflictMessage } from '../../lib/checkout/purchaseConflictMessage';
import { startUnlimitedUpgrade } from '../../lib/backend/startUnlimitedUpgrade';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { PastDueNotice } from '../../components/PastDueNotice/PastDueNotice';
import { AnonymousDayPassOffer } from '../../components/AnonymousDayPassOffer/AnonymousDayPassOffer';
import { PassFirstOffer } from '../../components/PassFirstOffer/PassFirstOffer';
import { deckCardsBucket } from './deckCardsBucket';
import {
  ANONYMOUS_CARD_CAP,
  FREE_MONTHLY_CARDS,
  LimitWall,
  type PassKind,
  type WallOrder,
} from './LimitWall';
import { useUnlimitedMonthlyPrice } from './useUnlimitedMonthlyPrice';
import styles from './LimitPage.module.css';

const MAX_SHOWN_CARDS = 10000;

function parseTotalCards(raw: string | null): number | null {
  if (raw == null || !/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  if (parsed < 1 || parsed > MAX_SHOWN_CARDS) return null;
  return parsed;
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

function FreeAccountCard({
  t,
  featured,
  desktopFirst,
}: {
  t: Translate;
  featured: boolean;
  desktopFirst: boolean;
}) {
  return (
    <div
      className={[
        styles.planCard,
        featured ? styles.planCardFeatured : '',
        desktopFirst ? styles.freeFirstDesktop : '',
      ]
        .filter(Boolean)
        .join(' ')}
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

function DayPassCard({
  totalCards,
  featured,
}: {
  totalCards: number | null;
  featured: boolean;
}) {
  return (
    <div
      className={`${styles.planCard} ${featured ? styles.planCardFeatured : ''}`}
    >
      <AnonymousDayPassOffer
        surface="anonymous-limit-wall"
        totalCards={totalCards ?? undefined}
        dayPassCard
        emphasis={featured ? 'primary' : 'secondary'}
      />
    </div>
  );
}

// The Day Pass card is first in the DOM so it leads on mobile in every state;
// on desktop a free-month deck pulls the free account back to the first column.
function AnonymousLimitCards({ totalCards }: { totalCards: number | null }) {
  const { t } = useTranslation('accountx');
  const overMonth = totalCards != null && totalCards > FREE_MONTHLY_CARDS;
  return (
    <div className={styles.plans}>
      <DayPassCard totalCards={totalCards} featured={overMonth} />
      <FreeAccountCard t={t} featured={!overMonth} desktopFirst={!overMonth} />
    </div>
  );
}

// Pass-first: both passes lead, free sign-up and sign-in are text links.
function AnonymousPassFirst({ totalCards }: { totalCards: number | null }) {
  const { t } = useTranslation('passFirst');
  const { t: tAccount } = useTranslation('accountx');
  return (
    <div className={styles.passFirst}>
      <PassFirstOffer
        surface="anonymous-limit-wall"
        headline={
          totalCards == null
            ? t('everyCard')
            : t('fileTotal', { total: totalCards })
        }
        body={t('anonBody', { cap: ANONYMOUS_CARD_CAP })}
        note={
          totalCards == null
            ? t('afterPayRedrop')
            : t('afterPayRedropTotal', { total: totalCards })
        }
      >
        <Link
          to="/register?redirect=/upload"
          onClick={() =>
            track('paywall_upgrade_clicked', {
              surface: REF,
              plan: 'free_signup',
            })
          }
        >
          {t('freeSignup')}
        </Link>
        <Link
          to="/login?redirect=/upload"
          onClick={() =>
            track('paywall_upgrade_clicked', {
              surface: REF,
              plan: 'sign_in',
            })
          }
        >
          {t('signIn')}
        </Link>
      </PassFirstOffer>
      <p className={styles.planNote}>{tAccount('limit.browserNote')}</p>
    </div>
  );
}

function AnonymousLimit({
  dayPassCardEnabled,
  passFirst,
}: {
  dayPassCardEnabled: boolean;
  passFirst: boolean;
}) {
  const { t } = useTranslation('accountx');
  const [searchParams] = useSearchParams();
  const readsCardCount = dayPassCardEnabled || passFirst;
  const totalCards = readsCardCount
    ? parseTotalCards(searchParams.get('cards'))
    : null;

  useEffect(() => {
    track('paywall_shown', {
      surface: REF,
      variant: 'anonymous',
      ...(readsCardCount && totalCards != null
        ? { deck_cards: deckCardsBucket(totalCards) }
        : {}),
    });
  }, [readsCardCount, totalCards]);

  let plans: ReactElement | null = null;
  if (passFirst) {
    plans = <AnonymousPassFirst totalCards={totalCards} />;
  } else if (dayPassCardEnabled) {
    plans = <AnonymousLimitCards totalCards={totalCards} />;
  }

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

      {plans ?? (
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
  const passFirst = userLocals?.features?.limitWallPassFirst === true;
  const unlimitedPrice = useUnlimitedMonthlyPrice(
    isLoggedIn && userLocals?.features?.limitWallProPrice === true
  );

  useEffect(() => {
    if (isLoading || showAnonymous) return;
    track('paywall_shown', { surface: REF });
  }, [isLoading, showAnonymous]);

  if (isLoading) {
    return <div className={styles.page} aria-busy="true" />;
  }

  if (showAnonymous) {
    return (
      <AnonymousLimit
        dayPassCardEnabled={userLocals?.features?.anonymousDayPassCard === true}
        passFirst={passFirst}
      />
    );
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
      order={passFirst ? 'passes-first' : WALL_ORDER}
      featureSemester={passFirst}
      pendingPass={pendingPass}
      onPass={handlePassCheckout}
      passError={passError}
      unlimitedHref={unlimitedLink}
      unlimitedPrice={unlimitedPrice}
      onUnlimitedClick={handleUnlimitedClick}
      notice={isLoggedIn ? <PastDueNotice surface={REF} /> : null}
    />
  );
}

export default LimitPage;
