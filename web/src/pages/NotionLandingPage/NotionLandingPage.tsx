import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { track } from '../../lib/analytics/track';
import { canonicalUrl } from '../../lib/seo/canonicalUrl';
import { PricingCard } from '../PricingPage/components/PricingCard';
import styles from './NotionLandingPage.module.css';

const REF = 'notion-marketplace';
const CANONICAL = canonicalUrl('/notion-marketplace');

const CONNECT_HREF = `/register?source=${REF}&ref=${REF}`;
const UNLIMITED_HREF = `/pricing?ref=${REF}`;
const DAY_PASS_HREF = `/pricing?ref=${REF}`;

export function NotionLandingPage() {
  const { t } = useTranslation('marketing');

  const unlimitedBenefits = [
    t('notionLanding.unlimitedBenefit1'),
    t('notionLanding.unlimitedBenefit2'),
    t('notionLanding.unlimitedBenefit3'),
  ];

  const dayPassBenefits = [
    t('notionLanding.dayPassBenefit1'),
    t('notionLanding.dayPassBenefit2'),
    t('notionLanding.dayPassBenefit3'),
  ];

  const metaTitle = t('notionLanding.metaTitle');
  const metaDescription = t('notionLanding.metaDescription');

  useEffect(() => {
    track('paywall_shown', { surface: REF });
  }, []);

  const handleUnlimitedClick = () => {
    track('paywall_upgrade_clicked', { surface: REF, plan: 'unlimited' });
  };

  const handleDayPassClick = () => {
    track('paywall_upgrade_clicked', { surface: REF, plan: 'day_pass' });
  };

  return (
    <div className={styles.page}>
      <Helmet>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={CANONICAL} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:url" content={CANONICAL} />
        <meta property="og:type" content="website" />
      </Helmet>

      <section className={styles.hero}>
        <h1 className={styles.heroHeadline}>
          {t('notionLanding.heroHeadline')}
        </h1>
        <p className={styles.heroSubhead}>{t('notionLanding.heroSubhead')}</p>
        <a href={CONNECT_HREF} className={styles.heroCta}>
          {t('notionLanding.connectNotion')}
        </a>
      </section>

      <hr className={styles.divider} />

      <section className={styles.plans}>
        <p className={styles.plansLabel}>{t('notionLanding.plans')}</p>
        <div className={styles.plansGrid}>
          <PricingCard
            badge={t('notionLanding.recommended')}
            title="Unlimited"
            priceChip={t('notionLanding.seePricing')}
            benefits={unlimitedBenefits}
            link={UNLIMITED_HREF}
            linkText={t('notionLanding.getUnlimited')}
            onLinkClick={handleUnlimitedClick}
          />
          <PricingCard
            title="Day Pass"
            price="$4"
            priceSuffix={t('notionLanding.dayPassSuffix')}
            benefits={dayPassBenefits}
            link={DAY_PASS_HREF}
            linkText={t('notionLanding.getDayPass')}
            variant="outline"
            caption={t('notionLanding.dayPassCaption')}
            onLinkClick={handleDayPassClick}
          />
        </div>
      </section>
    </div>
  );
}

export default NotionLandingPage;
