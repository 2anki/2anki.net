import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { LapsedPlan } from '../../../lib/checkout/checkoutConflict';
import sharedStyles from '../../../styles/shared.module.css';
import styles from '../PricingPage.module.css';

export function describeLapsedPlan(
  t: TFunction,
  plan: LapsedPlan,
  language?: string
): string {
  if (plan.amount == null || plan.interval == null) {
    return t('checkout.lapsed.planUnknown');
  }
  const price = new Intl.NumberFormat(language, {
    style: 'currency',
    currency: plan.currency.toUpperCase(),
  }).format(plan.amount / 100);
  return t(
    plan.interval === 'year'
      ? 'checkout.lapsed.planYear'
      : 'checkout.lapsed.planMonth',
    { price }
  );
}

// Shown when someone with an unpaid earlier plan starts Pro checkout. Nothing
// happens to the old plan until they pick one of the two: pay it and keep it,
// or end it and switch. The switch spells out that the old price is gone.
export function LapsedPlanChoice({
  plan,
  pending,
  onPay,
  onSwitch,
}: Readonly<{
  plan: LapsedPlan;
  pending: boolean;
  onPay: () => void;
  onSwitch: () => void;
}>) {
  const { t, i18n } = useTranslation();
  const planLabel = describeLapsedPlan(t, plan, i18n.language);

  return (
    <section
      className={styles.lapsedChoice}
      role="alert"
      aria-labelledby="lapsed-plan-title"
    >
      <h2 id="lapsed-plan-title" className={styles.lapsedTitle}>
        {t('checkout.lapsed.title')}
      </h2>
      <p>{t('checkout.lapsed.body', { plan: planLabel })}</p>
      <div className={styles.lapsedOptions}>
        <div>
          <a
            className={sharedStyles.btnPrimary}
            href={plan.payUrl ?? '/account'}
            onClick={onPay}
          >
            {t('checkout.lapsed.payButton')}
          </a>
          <p className={styles.lapsedNote}>
            {plan.payUrl == null
              ? t('checkout.lapsed.payNoteAccount')
              : t('checkout.lapsed.payNote', { plan: planLabel })}
          </p>
        </div>
        <div>
          <button
            type="button"
            className={sharedStyles.btnSecondary}
            onClick={onSwitch}
            disabled={pending}
          >
            {t('checkout.lapsed.switchButton')}
          </button>
          <p className={styles.lapsedNote}>
            {t('checkout.lapsed.switchNote', { plan: planLabel })}
          </p>
        </div>
      </div>
    </section>
  );
}
