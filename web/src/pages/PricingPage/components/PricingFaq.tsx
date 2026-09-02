import { useTranslation } from 'react-i18next';

import { buildPricingFaq } from '../pricingFaq';
import { FALLBACK_PASS_PRICES } from '../payment.links';
import type { PassPriceDisplay } from '../../../lib/hooks/usePassPrices';
import styles from './PricingFaq.module.css';

interface PricingFaqProps {
  passPrices?: PassPriceDisplay;
}

export function PricingFaq({
  passPrices = FALLBACK_PASS_PRICES,
}: Readonly<PricingFaqProps>) {
  const { t } = useTranslation('pricingtable');
  const faqItems = buildPricingFaq(passPrices);

  return (
    <section className={styles.faq} aria-labelledby="pricing-faq-heading">
      <h2 id="pricing-faq-heading" className={styles.heading}>
        {t('faq.heading')}
      </h2>
      <div className={styles.list}>
        {faqItems.map((item) => (
          <details key={item.questionKey} className={styles.item}>
            <summary className={styles.summary}>
              <span>{t(item.questionKey)}</span>
              <span className={styles.icon} aria-hidden="true" />
            </summary>
            <p className={styles.answer}>
              {t(item.answerKey, item.answerValues)}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
