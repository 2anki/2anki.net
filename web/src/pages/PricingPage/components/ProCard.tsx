import { useTranslation } from 'react-i18next';
import styles from '../PricingPage.module.css';
import {
  annualSavingsPercent,
  formatAnnual,
  formatAnnualPerMonth,
  formatMonthly,
} from '../pricing.constants';

export type BillingInterval = 'month' | 'year';

interface ProCardProps {
  onUpgrade: (interval: BillingInterval) => void;
  pending: BillingInterval | null;
  yearlyAvailable: boolean;
  monthlyCents: number;
  annualCents: number;
  error?: boolean;
  featured?: boolean;
}

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

const BENEFIT_KEYS = [
  'pricing.unlimited.benefitUnlimited',
  'pricing.unlimited.benefitApkg',
  'pricing.unlimited.benefitAi',
  'pricing.unlimited.benefitMultiple',
  'pricing.unlimited.benefitPdf',
  'pricing.unlimited.benefitImport',
  'pricing.unlimited.benefitPrint',
  'pricing.unlimited.benefitCancel',
];

/**
 * Each interval has its own button that carries its own interval into checkout.
 * The toggle this replaces kept the choice in component state that reset to
 * monthly on every remount and was dropped entirely across the sign-in
 * redirect, so a visitor who picked yearly was quietly checked out monthly.
 */
export function ProCard({
  onUpgrade,
  pending,
  yearlyAvailable,
  monthlyCents,
  annualCents,
  error = false,
  featured = false,
}: Readonly<ProCardProps>) {
  const { t } = useTranslation();
  const savings = annualSavingsPercent(monthlyCents, annualCents);
  const annualTotal = formatAnnual(annualCents);
  const monthlyTotal = formatMonthly(monthlyCents);
  const leadsWithYearly = yearlyAvailable;

  const heroPrice = leadsWithYearly
    ? formatAnnualPerMonth(annualCents)
    : monthlyTotal;

  const label = (interval: BillingInterval): string => {
    if (pending === interval) return t('pricing.unlimited.startingCheckout');
    if (error) return t('pricing.unlimited.tryAgain');
    return interval === 'year'
      ? t('pricing.unlimited.getUnlimitedYearly')
      : t('pricing.unlimited.getUnlimitedMonthly');
  };

  return (
    <div
      className={featured ? `${styles.card} ${styles.cardPro}` : styles.card}
      data-testid="pro-card"
    >
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>Pro</h3>
        <span className={styles.cardPriceLine}>
          <span className={styles.cardPrice}>{heroPrice}</span>
          <span className={styles.cardPriceSuffix}>
            {t('pricing.unlimited.perMonth')}
          </span>
        </span>
        <p className={styles.yearlyHint}>
          {leadsWithYearly
            ? t('pricing.unlimited.yearlyHint', { annualTotal, savings })
            : t('pricing.unlimited.monthlyHint', { monthlyTotal })}
        </p>
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
        {leadsWithYearly && (
          <button
            type="button"
            className={styles.cardButton}
            onClick={() => onUpgrade('year')}
            disabled={pending != null}
          >
            {label('year')}
          </button>
        )}
        <button
          type="button"
          className={
            leadsWithYearly ? styles.cardButtonOutline : styles.cardButton
          }
          onClick={() => onUpgrade('month')}
          disabled={pending != null}
        >
          {label('month')}
        </button>
        {error ? (
          <p className={styles.cardCaption}>
            {t('pricing.unlimited.checkoutError')}
          </p>
        ) : (
          <p className={styles.cardTerms}>
            {leadsWithYearly
              ? t('pricing.unlimited.termsYearly', { annualTotal })
              : t('pricing.unlimited.termsMonthly', { monthlyTotal })}
          </p>
        )}
        <p className={styles.cardCaption}>
          {t('pricing.unlimited.pauseReassurance')}
        </p>
      </div>
    </div>
  );
}
