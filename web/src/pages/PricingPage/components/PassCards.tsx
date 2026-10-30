import { useTranslation } from 'react-i18next';
import { PricingCard } from './PricingCard';
import { FALLBACK_PASS_PRICES } from '../payment.links';
import type { PassPriceDisplay } from '../../../lib/hooks/usePassPrices';
import styles from '../PricingPage.module.css';

export const PASS_BENEFIT_KEYS = [
  'pricing.pass.noSubscription',
  'pricing.pass.unlimitedCards',
  'pricing.pass.aiPhoto',
  'pricing.pass.everyFormat',
  'pricing.pass.nativeApkg',
  'pricing.pass.imageOcclusion',
];

interface PassCardsProps {
  onDayPass: () => void;
  onWeekPass: () => void;
  onSemesterPass?: () => void;
  dayPassPending: boolean;
  weekPassPending: boolean;
  semesterPassPending?: boolean;
  featureDayPass?: boolean;
  featureSemester?: boolean;
  prices?: PassPriceDisplay;
  benefits?: string[];
}

function featuredClass(featured: boolean) {
  return featured ? styles.cardPro : undefined;
}

export function PassCards({
  onDayPass,
  onWeekPass,
  onSemesterPass,
  dayPassPending,
  weekPassPending,
  semesterPassPending = false,
  featureDayPass = true,
  featureSemester = false,
  prices = FALLBACK_PASS_PRICES,
  benefits,
}: Readonly<PassCardsProps>) {
  const { t } = useTranslation();
  const cardBenefits = benefits ?? PASS_BENEFIT_KEYS.map((key) => t(key));
  const showHorizons = !featureDayPass;
  const startingCheckout = t('pricing.pass.startingCheckout');

  const dayCard = (
    <PricingCard
      key="day"
      title="Day Pass"
      badge={t('pricing.pass.mostPopular')}
      className={featuredClass(featureDayPass)}
      horizonCaption={showHorizons ? t('pricing.pass.horizonDay') : undefined}
      price={prices['24h']}
      priceSuffix={t('pricing.pass.day24')}
      benefits={cardBenefits}
      onAction={onDayPass}
      actionLabel={
        dayPassPending
          ? startingCheckout
          : t('pricing.pass.getDayPass', { price: prices['24h'] })
      }
      actionDisabled={dayPassPending}
    />
  );

  const weekCard = (
    <PricingCard
      key="week"
      title="Week Pass"
      horizonCaption={showHorizons ? t('pricing.pass.horizonWeek') : undefined}
      price={prices['7d']}
      priceSuffix={t('pricing.pass.week1')}
      benefits={cardBenefits}
      onAction={onWeekPass}
      actionLabel={
        weekPassPending
          ? startingCheckout
          : t('pricing.pass.getWeekPass', { price: prices['7d'] })
      }
      actionDisabled={weekPassPending}
    />
  );

  const semesterCard =
    onSemesterPass == null ? null : (
      <PricingCard
        key="semester"
        title="Semester Pass"
        className={featuredClass(featureSemester)}
        badge={t('pricing.pass.bestValue')}
        badgeMuted
        horizonCaption={t('pricing.pass.horizonSemester')}
        valueCaption={t('pricing.pass.semesterPerWeek')}
        price={prices['120d']}
        priceSuffix={t('pricing.pass.semester4mo')}
        benefits={cardBenefits}
        onAction={onSemesterPass}
        actionLabel={
          semesterPassPending
            ? startingCheckout
            : t('pricing.pass.getSemesterPass', { price: prices['120d'] })
        }
        actionDisabled={semesterPassPending}
      />
    );

  const cards = featureSemester
    ? [semesterCard, weekCard, dayCard]
    : [dayCard, weekCard, semesterCard];

  return <div className={styles.passGrid}>{cards}</div>;
}
