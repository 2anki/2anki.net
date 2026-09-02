import { useTranslation } from 'react-i18next';
import styles from '../PricingPage.module.css';
import {
  annualSavingsPercent,
  formatAnnual,
  formatAnnualPerMonth,
  formatMonthly,
} from '../pricing.constants';

interface UnlimitedCardProps {
  isLoggedIn: boolean;
  billingCycle: 'month' | 'year';
  onBillingCycleChange: (cycle: 'month' | 'year') => void;
  yearlyAvailable: boolean;
  onUpgrade: () => void;
  pending: boolean;
  monthlyCents: number;
  annualCents: number;
  error?: boolean;
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

export function UnlimitedCard({
  billingCycle,
  onBillingCycleChange,
  yearlyAvailable,
  onUpgrade,
  pending,
  monthlyCents,
  annualCents,
  error = false,
}: Readonly<UnlimitedCardProps>) {
  const { t } = useTranslation();
  const isYearly = billingCycle === 'year';
  const savings = annualSavingsPercent(monthlyCents, annualCents);
  const heroPrice = isYearly
    ? formatAnnualPerMonth(annualCents)
    : formatMonthly(monthlyCents);
  const annualTotal = formatAnnual(annualCents);
  const monthlyTotal = formatMonthly(monthlyCents);

  const terms = isYearly
    ? t('pricing.unlimited.termsYearly', { annualTotal })
    : t('pricing.unlimited.termsMonthly', { monthlyTotal });

  function getButtonLabel(): string {
    if (error) return t('pricing.unlimited.tryAgain');
    if (pending) return t('pricing.unlimited.startingCheckout');
    return isYearly
      ? t('pricing.unlimited.getUnlimitedYearly')
      : t('pricing.unlimited.getUnlimitedMonthly');
  }

  return (
    <div className={`${styles.card} ${styles.cardPro}`}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>Unlimited</h3>
        <span className={styles.cardPriceLine}>
          <span className={styles.cardPrice}>{heroPrice}</span>
          <span className={styles.cardPriceSuffix}>
            {t('pricing.unlimited.perMonth')}
          </span>
        </span>
        {isYearly ? (
          <p className={styles.yearlyHint}>
            {t('pricing.unlimited.yearlyHint', { annualTotal, savings })}
          </p>
        ) : (
          <p className={styles.yearlyHint}>
            {t('pricing.unlimited.monthlyHint', { monthlyTotal })}
          </p>
        )}
        {yearlyAvailable && (
          <div
            role="radiogroup"
            aria-label={t('pricing.unlimited.billingCycle')}
            className={styles.billingToggle}
          >
            <button
              type="button"
              role="radio"
              aria-checked={isYearly}
              className={
                isYearly
                  ? styles.billingToggleOptionActive
                  : styles.billingToggleOption
              }
              onClick={() => onBillingCycleChange('year')}
            >
              {t('pricing.unlimited.yearlyOption', { savings })}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!isYearly}
              className={
                isYearly
                  ? styles.billingToggleOption
                  : styles.billingToggleOptionActive
              }
              onClick={() => onBillingCycleChange('month')}
            >
              {t('pricing.unlimited.monthlyOption')}
            </button>
          </div>
        )}
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
        <button
          type="button"
          className={styles.cardButton}
          onClick={onUpgrade}
          disabled={pending}
        >
          {getButtonLabel()}
        </button>
        {error ? (
          <p className={styles.cardCaption}>
            {t('pricing.unlimited.checkoutError')}
          </p>
        ) : (
          <p className={styles.cardTerms}>{terms}</p>
        )}
        <p className={styles.cardCaption}>
          {t('pricing.unlimited.pauseReassurance')}
        </p>
      </div>
    </div>
  );
}
