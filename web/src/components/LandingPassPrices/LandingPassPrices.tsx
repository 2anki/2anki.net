import { useTranslation } from 'react-i18next';

import { useLivePassPrices } from '../../lib/hooks/usePassPrices';
import { useLandingPassPricesEnabled } from '../../lib/hooks/useLandingPassPrices';
import styles from './LandingPassPrices.module.css';

const HEADING_ID = 'landing-pass-prices-heading';

interface Props {
  readonly centered?: boolean;
}

export function LandingPassPrices({ centered = false }: Readonly<Props>) {
  const { t } = useTranslation('landing');
  const enabled = useLandingPassPricesEnabled();
  const prices = useLivePassPrices();
  const dayPrice = prices['24h'];
  const semesterPrice = prices['120d'];

  const canShow = enabled && dayPrice != null && semesterPrice != null;
  if (!canShow) {
    return null;
  }

  const className = centered
    ? `${styles.passPrices} ${styles.centered}`
    : styles.passPrices;

  return (
    <aside className={className} aria-labelledby={HEADING_ID}>
      <p id={HEADING_ID} className={styles.heading}>
        {t('passPrices.heading')}
      </p>
      <ul className={styles.list}>
        <li>{t('passPrices.dayPass', { dayPrice })}</li>
        <li>{t('passPrices.semesterPass', { semesterPrice })}</li>
      </ul>
      <p className={styles.footnote}>{t('passPrices.footnote')}</p>
    </aside>
  );
}

export default LandingPassPrices;
