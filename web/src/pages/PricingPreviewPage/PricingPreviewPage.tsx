import { useTranslation } from 'react-i18next';
import { ComparisonTable } from '../PricingPage/components/ComparisonTable';
import { PassCards } from '../PricingPage/components/PassCards';
import { PricingFaq } from '../PricingPage/components/PricingFaq';
import { ProCard } from '../PricingPage/components/ProCard';
import {
  OwnedPlanNotice,
  ownsOngoingAccess,
  type PricingEntitlement,
} from '../PricingPage/components/OwnedPlanNotice';
import type { PassPriceDisplay } from '../../lib/hooks/usePassPrices';
import {
  formatMonthly,
  LEGACY_UNLIMITED_PRICING,
} from '../PricingPage/pricing.constants';
import pricingStyles from '../PricingPage/PricingPage.module.css';
import styles from './PricingPreviewPage.module.css';

const noop = () => undefined;

const slugify = (label: string): string =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const PRICES: PassPriceDisplay = { '24h': '$6', '7d': '$12', '120d': '$29' };

const future = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();

interface State {
  label: string;
  note: string;
  entitlement: PricingEntitlement | undefined;
}

const states: State[] = [
  {
    label: 'Anonymous visitor',
    note: 'Not signed in. Sees the full menu. Every buy button should reach account creation before Stripe — anonymous visitors convert at 0.22% against 11.1% signed in.',
    entitlement: undefined,
  },
  {
    label: 'Signed-in free user',
    note: 'The page as most buyers meet it: interrupted mid-conversion at the monthly cap. Semester Pass leads.',
    entitlement: { subscriber: false },
  },
  {
    label: 'Active Semester Pass holder',
    note: 'A pass runs out, so the purchase menu stays — buying forward is a real choice. Banner names the pass and its expiry.',
    entitlement: {
      subscriber: true,
      passKind: '120d',
      passExpiresAt: future,
    },
  },
  {
    label: 'Stripe subscriber',
    note: 'Owns ongoing access. Every purchase option is suppressed — this is the state whose absence caused the chargeback in #4616.',
    entitlement: { subscriber: true, planSource: 'stripe' },
  },
  {
    label: 'Legacy-rate subscriber',
    note: 'Same suppression. They must never be shown the current rate, which is higher than the one they hold.',
    entitlement: { subscriber: true, planSource: 'stripe' },
  },
  {
    label: 'Apple-billed subscriber',
    note: 'Suppressed, and told where the billing actually lives so they do not look for it in Stripe.',
    entitlement: { subscriber: true, planSource: 'apple' },
  },
  {
    label: 'Lifetime holder',
    note: 'Suppressed. Lifetime is closed to new buyers but existing holders still see what they own.',
    entitlement: { patreon: true },
  },
];

function ProposedPurchaseArea({
  entitlement,
}: Readonly<{ entitlement: PricingEntitlement | undefined }>) {
  const { t } = useTranslation();

  return (
    <div className={pricingStyles.page}>
      <div className={pricingStyles.header}>
        <h1 className={pricingStyles.title}>{t('pricing.title')}</h1>
      </div>

      <OwnedPlanNotice entitlement={entitlement} />

      {ownsOngoingAccess(entitlement) ? null : (
        <>
          <h2 className={pricingStyles.sectionLabel}>
            {t('pricing.payOnceSection')}
          </h2>
          <PassCards
            onDayPass={noop}
            onWeekPass={noop}
            onSemesterPass={noop}
            dayPassPending={false}
            weekPassPending={false}
            semesterPassPending={false}
            featureDayPass={false}
            featureSemester
            prices={PRICES}
          />

          <h2 className={pricingStyles.sectionLabel}>
            {t('pricing.monthlySection')}
          </h2>
          <div className={pricingStyles.grid}>
            <ProCard
              onUpgrade={noop}
              pending={null}
              yearlyAvailable
              monthlyCents={LEGACY_UNLIMITED_PRICING.monthlyCents}
              annualCents={LEGACY_UNLIMITED_PRICING.annualCents}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function PricingPreviewPage() {
  const { t } = useTranslation();

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <h1 className={styles.introTitle}>Pricing — proposed redesign</h1>
        <p className={styles.introBody}>
          The purchase decision for every entitlement state, in the proposed
          order: passes first with the Semester Pass featured, the subscription
          below it, and the billing toggle replaced by one button per interval.
          The feature grid is gone; the comparison table moves below the
          decision. Prices here are fixed sample values, not live Stripe
          amounts.
        </p>
      </header>

      {states.map((state) => (
        <section
          key={state.label}
          className={styles.variant}
          data-preview={slugify(state.label)}
        >
          <div className={styles.variantHead}>
            <h2 className={styles.variantLabel}>{state.label}</h2>
            <p className={styles.variantNote}>{state.note}</p>
          </div>
          <div className={styles.variantBody}>
            <ProposedPurchaseArea entitlement={state.entitlement} />
          </div>
        </section>
      ))}

      <section className={styles.variant} data-preview="below-the-decision">
        <div className={styles.variantHead}>
          <h2 className={styles.variantLabel}>Below the decision</h2>
          <p className={styles.variantNote}>
            What a free user scrolls to after the cards: the honest comparison
            table and the questions. Everything above this point is the first
            screen.
          </p>
        </div>
        <div className={styles.variantBody}>
          <div className={pricingStyles.page}>
            <p className={pricingStyles.pricesNote}>
              {t('pricing.pricesNote')}
            </p>
            <ul className={pricingStyles.reassurance}>
              <li>{t('pricing.reassuranceCancel')}</li>
              <li>{t('pricing.reassuranceOwn')}</li>
            </ul>
            <ComparisonTable
              unlimitedMonthlyPrice={formatMonthly(
                LEGACY_UNLIMITED_PRICING.monthlyCents
              )}
              passPrices={PRICES}
            />
            <PricingFaq passPrices={PRICES} />
          </div>
        </div>
      </section>
    </div>
  );
}
