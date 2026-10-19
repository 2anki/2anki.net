import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import styles from '../AnkifyPage.module.css';
import { track } from '../../../lib/analytics/track';

export default function AnkifyPlanPanel() {
  const { t } = useTranslation('ankify');

  useEffect(() => {
    track('ankify_plan_required_viewed');
  }, []);

  return (
    <main className={styles.setupTakeover}>
      <header className={styles.setupTakeoverHeading}>
        <h1 className={styles.setupTakeoverTitle}>{t('plan.title')}</h1>
        <p className={styles.setupTakeoverSubtitle}>{t('plan.subtitle')}</p>
      </header>
      <section className={styles.setupActiveStep}>
        <p className={styles.setupActiveStepHint}>{t('plan.what')}</p>
        <Link to="/pricing" className={styles.planLink}>
          {t('plan.seePricing')}
        </Link>
      </section>
    </main>
  );
}
