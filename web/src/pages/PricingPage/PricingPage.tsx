import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import TopMessage from '../../components/TopMessage/TopMessage';
import { firePaywallEvent } from '../../lib/analytics/firePaywallEvent';
import { track } from '../../lib/analytics/track';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { useCardUsage } from '../../lib/hooks/useCardUsage';
import { usePricingOrderVariant } from '../../lib/hooks/usePricingOrderVariant';
import { ComparisonTable } from './components/ComparisonTable';
import { FeatureGrid } from './components/FeatureGrid';
import { PassCards } from './components/PassCards';
import { PricingFaq } from './components/PricingFaq';
import { UnlimitedCard } from './components/UnlimitedCard';
import { ProducerCaptureModal } from '../../components/ProducerCaptureModal/ProducerCaptureModal';
import { TrustNote } from '../../components/TrustNote/TrustNote';
import { useInViewOnce } from '../../lib/hooks/useInViewOnce';
import styles from './PricingPage.module.css';
import sharedStyles from '../../styles/shared.module.css';
import { formatMonthly, LEGACY_UNLIMITED_PRICING } from './pricing.constants';
import { PRICING_FAQ } from './pricingFaq';

interface PricingPageProps {
  isLoggedIn: boolean;
  email?: string;
  signupCountry?: string | null;
}

type PassState = 'idle' | 'pending' | 'error';

export default function PricingPage({
  isLoggedIn,
  email: _email,
  signupCountry,
}: Readonly<PricingPageProps>) {
  const { t } = useTranslation();
  const isUS = signupCountry === 'US';
  const [dayPassState, setDayPassState] = useState<PassState>('idle');
  const [weekPassState, setWeekPassState] = useState<PassState>('idle');
  const [semesterPassState, setSemesterPassState] = useState<PassState>('idle');
  const [billingCycle, setBillingCycle] = useState<'month' | 'year'>('month');
  const [producerModalOpen, setProducerModalOpen] = useState(false);
  const educatorsRef = useInViewOnce<HTMLElement>(() =>
    track('producer_entry_viewed', { source: 'pricing_page' })
  );
  const [unlimitedPending, setUnlimitedPending] = useState(false);
  const [unlimitedError, setUnlimitedError] = useState(false);
  const [pricing, setPricing] = useState(LEGACY_UNLIMITED_PRICING);
  const [searchParams] = useSearchParams();
  const fromPaywall = searchParams.get('source') === 'paywall-cancel';
  const fromContext = searchParams.get('from');
  const showContextBanner =
    fromContext != null && !isLoggedIn ? false : fromContext != null;
  const enteredAtRef = useRef(Date.now());
  const shownFiredRef = useRef(false);
  const cardUsage = useCardUsage(true);
  const pricingOrder = usePricingOrderVariant();
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

  const selectBillingCycle = (cycle: 'month' | 'year') => {
    setBillingCycle(cycle);
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

  const handleTryFreeClick = () => {
    track('pricing_try_clicked', {
      surface: 'pricing_page',
      variant: pricingOrder,
    });
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
    setPassState('error');
  };

  const handleUnlimitedUpgrade = async () => {
    track('paywall_upgrade_clicked', {
      surface: 'pricing_page',
      plan: 'unlimited',
      variant: pricingOrder,
    });
    if (!isLoggedIn) {
      globalThis.location.href = '/login?redirect=/pricing';
      return;
    }
    setUnlimitedError(false);
    setUnlimitedPending(true);
    const result = await get2ankiApi().startUnlimitedCheckout(
      billingCycle,
      pricingOrder,
      'pricing_page'
    );
    if ('url' in result) {
      globalThis.location.href = result.url;
      return;
    }
    setUnlimitedPending(false);
    setUnlimitedError(true);
  };

  const pricingFaqJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: PRICING_FAQ.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  });

  const unlimitedFirst = pricingOrder === 'unlimited-first';
  const minimalHeader = pricingOrder === 'minimal';

  const passCards = (
    <PassCards
      onDayPass={() => handlePassCheckout('24h')}
      onWeekPass={() => handlePassCheckout('7d')}
      onSemesterPass={() => handlePassCheckout('120d')}
      dayPassPending={dayPassState === 'pending'}
      weekPassPending={weekPassState === 'pending'}
      semesterPassPending={semesterPassState === 'pending'}
      featureDayPass={false}
    />
  );

  const monthlyPlans = (
    <div className={styles.grid}>
      <UnlimitedCard
        isLoggedIn={isLoggedIn}
        billingCycle={billingCycle}
        onBillingCycleChange={selectBillingCycle}
        yearlyAvailable={yearlyAvailable}
        onUpgrade={handleUnlimitedUpgrade}
        pending={unlimitedPending}
        monthlyCents={pricing.monthlyCents}
        annualCents={pricing.annualCents}
        error={unlimitedError}
      />
    </div>
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
        {!minimalHeader && (
          <p className={styles.intro}>
            {isUS ? t('pricing.introUS') : t('pricing.introDefault')}
          </p>
        )}
        {!isLoggedIn && (
          <a
            href="/upload"
            className={styles.tryFreeCta}
            onClick={handleTryFreeClick}
          >
            {t('pricing.tryFree')}
          </a>
        )}
        {!minimalHeader && (
          <p className={styles.socialProof}>{t('pricing.socialProof')}</p>
        )}
      </div>

      {unlimitedFirst ? (
        <>
          {monthlySection}
          {passesSection}
        </>
      ) : (
        <>
          {passesSection}
          {monthlySection}
        </>
      )}

      <p className={styles.pricesNote}>{t('pricing.pricesNote')}</p>

      <ul className={styles.reassurance}>
        <li>{t('pricing.reassuranceCancel')}</li>
        <li>{t('pricing.reassuranceOwn')}</li>
      </ul>

      <TrustNote compact />

      <FeatureGrid />

      <ComparisonTable
        unlimitedMonthlyPrice={formatMonthly(pricing.monthlyCents)}
      />

      <PricingFaq />

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
