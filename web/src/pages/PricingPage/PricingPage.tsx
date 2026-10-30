import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import TopMessage from '../../components/TopMessage/TopMessage';
import { firePaywallEvent } from '../../lib/analytics/firePaywallEvent';
import { track } from '../../lib/analytics/track';
import { landingViewProps } from '../../lib/adClick';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import type { CheckoutConflict } from '../../lib/checkout/checkoutConflict';
import { purchaseConflictMessage } from '../../lib/checkout/purchaseConflictMessage';
import { useCardUsage } from '../../lib/hooks/useCardUsage';
import { usePricingOrderVariant } from '../../lib/hooks/usePricingOrderVariant';
import {
  AutoSyncCard,
  type AutoSyncCardState,
} from './components/AutoSyncCard';
import { ComparisonTable } from './components/ComparisonTable';
import { FeatureGrid } from './components/FeatureGrid';
import {
  DayPassCard,
  PASS_BENEFIT_KEYS,
  PassCards,
  SemesterPassCard,
  WeekPassCard,
} from './components/PassCards';
import { PricingFaq } from './components/PricingFaq';
import { UnlimitedCard } from './components/UnlimitedCard';
import { LapsedPlanChoice } from './components/LapsedPlanChoice';
import { ProducerCaptureModal } from '../../components/ProducerCaptureModal/ProducerCaptureModal';
import { TrustNote } from '../../components/TrustNote/TrustNote';
import { useInViewOnce } from '../../lib/hooks/useInViewOnce';
import styles from './PricingPage.module.css';
import sharedStyles from '../../styles/shared.module.css';
import { formatMonthly, LEGACY_UNLIMITED_PRICING } from './pricing.constants';
import { buildPricingFaq } from './pricingFaq';
import { usePassPrices } from '../../lib/hooks/usePassPrices';
import {
  OwnedPlanNotice,
  activePassKind,
  ownsOngoingAccess,
  type PricingEntitlement,
} from './components/OwnedPlanNotice';

interface PricingPageProps {
  isLoggedIn: boolean;
  email?: string;
  signupCountry?: string | null;
  entitlement?: PricingEntitlement;
  autoSyncActive?: boolean;
  autoSyncCapReached?: boolean;
}

type PassState = 'idle' | 'pending' | 'error';

export default function PricingPage({
  isLoggedIn,
  email: _email,
  signupCountry,
  entitlement,
  autoSyncActive = false,
  autoSyncCapReached = false,
}: Readonly<PricingPageProps>) {
  const { t, i18n } = useTranslation();
  const isUS = signupCountry === 'US';
  const [conflict, setConflict] = useState<CheckoutConflict | null>(null);
  const conflictRef = useRef<HTMLDivElement>(null);

  // The conflict renders above the cards, out of view of the button that
  // raised it.
  useEffect(() => {
    if (conflict != null) {
      conflictRef.current?.scrollIntoView?.({ block: 'center' });
    }
  }, [conflict]);
  const [dayPassState, setDayPassState] = useState<PassState>('idle');
  const [weekPassState, setWeekPassState] = useState<PassState>('idle');
  const [semesterPassState, setSemesterPassState] = useState<PassState>('idle');
  const [searchParams, setSearchParams] = useSearchParams();
  const [billingCycle, setBillingCycle] = useState<'month' | 'year'>(
    searchParams.get('interval') === 'year' ? 'year' : 'month'
  );
  const [producerModalOpen, setProducerModalOpen] = useState(false);
  const educatorsRef = useInViewOnce<HTMLElement>(() =>
    track('producer_entry_viewed', { source: 'pricing_page' })
  );
  const [unlimitedPending, setUnlimitedPending] = useState(false);
  const [unlimitedError, setUnlimitedError] = useState(false);
  const [pricing, setPricing] = useState(LEGACY_UNLIMITED_PRICING);
  const [autoSyncPrice, setAutoSyncPrice] = useState<{
    display: string;
    interval: string;
  } | null>(null);
  const [autoSyncPending, setAutoSyncPending] = useState(false);
  const [autoSyncOutcome, setAutoSyncOutcome] = useState<
    'unavailable' | 'error' | null
  >(null);
  const fromPaywall = searchParams.get('source') === 'paywall-cancel';
  const fromContext = searchParams.get('from');
  const showContextBanner =
    fromContext != null && !isLoggedIn ? false : fromContext != null;
  const enteredAtRef = useRef(Date.now());
  const shownFiredRef = useRef(false);
  const landingViewedRef = useRef(false);
  const cardUsage = useCardUsage(true);
  const pricingOrder = usePricingOrderVariant();
  const passPrices = usePassPrices();
  const quotaRemaining =
    cardUsage != null && !cardUsage.loading
      ? cardUsage.cards_limit - cardUsage.cards_used
      : null;

  const yearlyAvailable = pricing.annualCents > 0;

  useEffect(() => {
    let cancelled = false;
    get2ankiApi()
      .getCheckoutPrices()
      .then((result) => {
        if (cancelled || result == null) return;
        setPricing({
          monthlyCents: result.monthly.cents,
          annualCents: result.annual.cents,
          legacy: result.legacy,
          lockInDeadline: result.lockInDeadline,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    get2ankiApi()
      .getAutoSyncPrice()
      .then((result) => {
        if (!cancelled) setAutoSyncPrice(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (landingViewedRef.current) return;
    landingViewedRef.current = true;
    track('landing_page_viewed', landingViewProps('/pricing'));
  }, []);

  // The interval lives in the URL as well as in state. Component state alone
  // was lost on any remount and discarded entirely by the sign-in redirect,
  // which sent someone who chose yearly back to a page defaulted to monthly.
  const selectBillingCycle = (cycle: 'month' | 'year') => {
    setBillingCycle(cycle);
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        if (cycle === 'year') {
          next.set('interval', 'year');
        } else {
          next.delete('interval');
        }
        return next;
      },
      { replace: true }
    );
    track('plan_interval_selected', { interval: cycle });
  };

  useEffect(() => {
    if (shownFiredRef.current) return;
    if (cardUsage?.loading) return;
    shownFiredRef.current = true;
    const props =
      quotaRemaining == null
        ? { surface: 'pricing_page' as const, variant: pricingOrder }
        : {
            surface: 'pricing_page' as const,
            quota_remaining: quotaRemaining,
            variant: pricingOrder,
          };
    track('paywall_shown', props);
  }, [cardUsage, quotaRemaining, pricingOrder]);

  useEffect(() => {
    const enteredAt = enteredAtRef.current;
    const leftFiredRef = { current: false };

    const fireLeft = () => {
      if (leftFiredRef.current) return;
      leftFiredRef.current = true;
      const seconds_on_page = Math.round((Date.now() - enteredAt) / 1000);
      track('pricing_left', { seconds_on_page });
    };

    globalThis.addEventListener('pagehide', fireLeft);
    return () => {
      globalThis.removeEventListener('pagehide', fireLeft);
      fireLeft();
    };
  }, []);

  useEffect(() => {
    if (fromPaywall) {
      firePaywallEvent('paywall_pricing_viewed');
    }
  }, [fromPaywall]);

  const connectorFirst = pricingOrder === 'mcp-day-first';

  const connectorRefParams = () => {
    const params = new URLSearchParams();
    if (connectorFirst) {
      params.set('ref', 'mcp');
    }
    return params;
  };

  const pricingPath = (params: URLSearchParams, hash = '') => {
    const query = params.toString();
    return query === '' ? `/pricing${hash}` : `/pricing?${query}${hash}`;
  };

  const handlePassCheckout = async (kind: '24h' | '7d' | '120d') => {
    const planByKind = {
      '24h': 'day_pass',
      '7d': 'week_pass',
      '120d': 'semester_pass',
    } as const;
    const setPassState = {
      '24h': setDayPassState,
      '7d': setWeekPassState,
      '120d': setSemesterPassState,
    }[kind];
    track('paywall_upgrade_clicked', {
      surface: 'pricing_page',
      plan: planByKind[kind],
      variant: pricingOrder,
    });
    if (connectorFirst && !isLoggedIn) {
      globalThis.location.href = `/login?redirect=${encodeURIComponent(pricingPath(connectorRefParams()))}`;
      return;
    }
    setConflict(null);
    setPassState('pending');
    const result = await get2ankiApi().startPassCheckout(
      kind,
      pricingOrder,
      'pricing_page'
    );
    if ('url' in result) {
      globalThis.location.href = result.url;
      return;
    }
    if (result.status === 'conflict') {
      setConflict(result);
      setPassState('idle');
      return;
    }
    setPassState('error');
  };

  const handleUnlimitedUpgrade = async (replaceLapsed = false) => {
    track('paywall_upgrade_clicked', {
      surface: 'pricing_page',
      plan: 'unlimited',
      variant: pricingOrder,
    });
    if (!isLoggedIn) {
      const params = connectorRefParams();
      if (billingCycle === 'year') {
        params.set('interval', 'year');
      }
      globalThis.location.href = `/login?redirect=${encodeURIComponent(pricingPath(params))}`;
      return;
    }
    setConflict(null);
    setUnlimitedError(false);
    setUnlimitedPending(true);
    const result = await get2ankiApi().startUnlimitedCheckout(
      billingCycle,
      pricingOrder,
      'pricing_page',
      replaceLapsed
    );
    if ('url' in result) {
      globalThis.location.href = result.url;
      return;
    }
    setUnlimitedPending(false);
    if (result.status === 'conflict') {
      if (result.lapsedPlan != null) {
        track('checkout_lapsed_plan_shown', {
          interval: billingCycle,
          has_pay_link: result.lapsedPlan.payUrl != null,
        });
      }
      setConflict(result);
      return;
    }
    setUnlimitedError(true);
  };

  const handleAutoSyncCheckout = async () => {
    track('paywall_upgrade_clicked', {
      surface: 'pricing_page',
      plan: 'auto_sync',
      variant: pricingOrder,
    });
    if (!isLoggedIn) {
      globalThis.location.href = `/login?redirect=${encodeURIComponent(pricingPath(connectorRefParams(), '#auto-sync'))}`;
      return;
    }
    setConflict(null);
    setAutoSyncOutcome(null);
    setAutoSyncPending(true);
    const result = await get2ankiApi().startAutoSyncCheckout(
      pricingOrder,
      'pricing_page'
    );
    if ('url' in result) {
      globalThis.location.href = result.url;
      return;
    }
    setAutoSyncPending(false);
    if (result.status === 'conflict') {
      setConflict(result);
      return;
    }
    if (result.status === 'already_subscribed') {
      globalThis.location.href = '/ankify/setup';
      return;
    }
    setAutoSyncOutcome(result.status === 'error' ? 'error' : 'unavailable');
  };

  const autoSyncCardState = (): AutoSyncCardState => {
    if (autoSyncActive) return 'active';
    if (autoSyncOutcome != null) return autoSyncOutcome;
    if (autoSyncCapReached) return 'full';
    if (ownsOngoingAccess(entitlement)) return 'switch';
    return 'buy';
  };

  // Lifetime already includes Auto Sync, and an Apple plan cannot be switched
  // from here, so neither is offered it.
  const showAutoSync =
    autoSyncPrice != null &&
    entitlement?.patreon !== true &&
    entitlement?.planSource !== 'apple';

  const autoSyncSection =
    showAutoSync && autoSyncPrice != null ? (
      <>
        <h2 className={styles.sectionLabel}>{t('autosync:section')}</h2>
        <div className={styles.grid}>
          <AutoSyncCard
            price={autoSyncPrice.display}
            interval={autoSyncPrice.interval}
            state={autoSyncCardState()}
            pending={autoSyncPending}
            onBuy={handleAutoSyncCheckout}
          />
        </div>
      </>
    ) : null;

  const pricingFaqJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: buildPricingFaq(passPrices).map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  });

  const unlimitedFirst = pricingOrder === 'unlimited-first';
  const semesterFirst = pricingOrder === 'semester-first';
  const minimalHeader =
    pricingOrder === 'minimal' || semesterFirst || connectorFirst;
  const showConnectorIntro =
    connectorFirst &&
    !ownsOngoingAccess(entitlement) &&
    activePassKind(entitlement) == null;

  const passCards = (
    <PassCards
      onDayPass={() => handlePassCheckout('24h')}
      onWeekPass={() => handlePassCheckout('7d')}
      onSemesterPass={() => handlePassCheckout('120d')}
      dayPassPending={dayPassState === 'pending'}
      weekPassPending={weekPassState === 'pending'}
      semesterPassPending={semesterPassState === 'pending'}
      featureDayPass={false}
      featureSemester={semesterFirst}
      prices={passPrices}
    />
  );

  const unlimitedCard = (featured: boolean) => (
    <UnlimitedCard
      isLoggedIn={isLoggedIn}
      billingCycle={billingCycle}
      onBillingCycleChange={selectBillingCycle}
      yearlyAvailable={yearlyAvailable}
      onUpgrade={() => void handleUnlimitedUpgrade()}
      pending={unlimitedPending}
      monthlyCents={pricing.monthlyCents}
      annualCents={pricing.annualCents}
      error={unlimitedError}
      featured={featured}
    />
  );

  const monthlyPlans = (
    <div className={styles.grid}>{unlimitedCard(!semesterFirst)}</div>
  );

  const passesSection = (
    <>
      <h2 className={styles.sectionLabel}>{t('pricing.payOnceSection')}</h2>
      {passCards}
    </>
  );

  const monthlySection = (
    <>
      <h2 className={styles.sectionLabel}>{t('pricing.monthlySection')}</h2>
      {monthlyPlans}
    </>
  );

  const passBenefits = PASS_BENEFIT_KEYS.map((key) => t(key));

  const connectorSections = (
    <>
      <h2 className={sharedStyles.srOnly}>{t('pricing.kicker')}</h2>
      <div className={styles.passGrid}>
        <DayPassCard
          onSelect={() => handlePassCheckout('24h')}
          pending={dayPassState === 'pending'}
          price={passPrices['24h']}
          benefits={passBenefits}
          featured
        />
        {unlimitedCard(false)}
      </div>
      <h2 className={styles.sectionLabel}>{t('pricing.morePassesSection')}</h2>
      <div className={styles.passGrid}>
        <WeekPassCard
          onSelect={() => handlePassCheckout('7d')}
          pending={weekPassState === 'pending'}
          price={passPrices['7d']}
          benefits={passBenefits}
        />
        <SemesterPassCard
          onSelect={() => handlePassCheckout('120d')}
          pending={semesterPassState === 'pending'}
          price={passPrices['120d']}
          benefits={passBenefits}
        />
      </div>
    </>
  );

  const planSections = () => {
    if (ownsOngoingAccess(entitlement)) return null;
    if (connectorFirst) return connectorSections;
    if (unlimitedFirst) {
      return (
        <>
          {monthlySection}
          {passesSection}
        </>
      );
    }
    return (
      <>
        {passesSection}
        {monthlySection}
      </>
    );
  };

  return (
    <div className={styles.page}>
      <Helmet>
        <script type="application/ld+json">{pricingFaqJsonLd}</script>
      </Helmet>
      <div className={styles.header}>
        {!minimalHeader && (
          <p className={styles.kicker}>
            <span className={styles.kickerDot} aria-hidden="true" />
            <span>{t('pricing.kicker')}</span>
          </p>
        )}
        <h1 className={styles.title}>{t('pricing.title')}</h1>
        <TopMessage />
        {showContextBanner && (
          <div className={styles.contextBanner} role="status">
            {t('pricing.contextBanner')}
          </div>
        )}
        {showConnectorIntro && (
          <p className={styles.intro}>{t('pricing.connectorIntro')}</p>
        )}
        {!minimalHeader && (
          <p className={styles.intro}>
            {isUS ? t('pricing.introUS') : t('pricing.introDefault')}
          </p>
        )}
        {!minimalHeader && (
          <p className={styles.socialProof}>{t('pricing.socialProof')}</p>
        )}
      </div>

      <OwnedPlanNotice entitlement={entitlement} />

      <div ref={conflictRef}>
        {conflict?.lapsedPlan == null ? (
          conflict && (
            <div className={styles.contextBanner} role="alert">
              {purchaseConflictMessage(t, conflict, i18n.language)}
            </div>
          )
        ) : (
          <LapsedPlanChoice
            plan={conflict.lapsedPlan}
            pending={unlimitedPending}
            onPay={() =>
              track('checkout_lapsed_plan_choice', { choice: 'pay' })
            }
            onSwitch={() => {
              track('checkout_lapsed_plan_choice', { choice: 'switch' });
              void handleUnlimitedUpgrade(true);
            }}
          />
        )}
      </div>

      {planSections()}

      {autoSyncSection}

      <p className={styles.pricesNote}>{t('pricing.pricesNote')}</p>

      <ul className={styles.reassurance}>
        <li>{t('pricing.reassuranceCancel')}</li>
        <li>{t('pricing.reassuranceOwn')}</li>
      </ul>

      <TrustNote compact />

      <FeatureGrid />

      <ComparisonTable
        unlimitedMonthlyPrice={formatMonthly(pricing.monthlyCents)}
        passPrices={passPrices}
      />

      <PricingFaq passPrices={passPrices} />

      <section ref={educatorsRef} className={styles.educators}>
        <h2 className={styles.educatorsTitle}>{t('pricing.educatorsTitle')}</h2>
        <p className={styles.educatorsBody}>{t('pricing.educatorsBody')}</p>
        <button
          type="button"
          className={sharedStyles.btnSecondary}
          onClick={() => setProducerModalOpen(true)}
        >
          {t('pricing.educatorsButton')}
        </button>
      </section>

      <p className={styles.philosophy}>{t('pricing.philosophy')}</p>

      <ProducerCaptureModal
        isOpen={producerModalOpen}
        source="pricing_page"
        onClose={() => setProducerModalOpen(false)}
      />
    </div>
  );
}
