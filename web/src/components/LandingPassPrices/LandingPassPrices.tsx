import { useTranslation } from 'react-i18next';

import { usePassPrices } from '../../lib/hooks/usePassPrices';
import { useLandingPassPricesEnabled } from '../../lib/hooks/useLandingPassPrices';
import styles from './LandingPassPrices.module.css';

export function LandingPassPrices() {
  const { t } = useTranslation('landing');
  const enabled = useLandingPassPricesEnabled();
  const prices = usePassPrices();

  if (!enabled) {
    return null;
  }

  return (
    <aside className={styles.passPrices}>
      <p className={styles.heading}>{t('passPrices.heading')}</p>
      <ul className={styles.list}>
        <li>{t('passPrices.dayPass', { dayPrice: prices['24h'] })}</li>
        <li>
          {t('passPrices.semesterPass', { semesterPrice: prices['120d'] })}
        </li>
      </ul>
      <p className={styles.footnote}>{t('passPrices.footnote')}</p>
    </aside>
  );
}

export default LandingPassPrices;
