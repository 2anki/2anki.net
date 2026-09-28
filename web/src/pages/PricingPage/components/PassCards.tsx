import { useTranslation } from 'react-i18next';
import { PricingCard } from './PricingCard';
import { FALLBACK_PASS_PRICES } from '../payment.links';
import type { PassPriceDisplay } from '../../../lib/hooks/usePassPrices';
import styles from '../PricingPage.module.css';

const PASS_BENEFIT_KEYS = [
  'pricing.pass.noSubscription',
  'pricing.pass.unlimitedCards',
  'pricing.pass.aiPhoto',
  'pricing.pass.everyFormat',
  'pricing.pass.nativeApkg',
  'pricing.pass.imageOcclusion',
];

type Translate = ReturnType<typeof useTranslation>['t'];

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
}

function actionLabel(t: Translate, pending: boolean, labelKey: string) {
  return pending ? t('pricing.pass.redirecting') : t(labelKey);
}

function featuredTreatment(t: Translate, featured: boolean) {
  return {
    badge: featured ? t('pricing.pass.mostPopular') : undefined,
    className: featured ? styles.cardPro : undefined,
  };
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
}: Readonly<PassCardsProps>) {
  const { t } = useTranslation();
  const benefits = PASS_BENEFIT_KEYS.map((key) => t(key));
  const featureWeek = !featureDayPass && !featureSemester;
  const showHorizons = !featureDayPass;

  const dayCard = (
    <PricingCard
      key="day"
      title="Day Pass"
      {...featuredTreatment(t, featureDayPass)}
      horizonCaption={showHorizons ? t('pricing.pass.horizonDay') : undefined}
      price={prices['24h']}
      priceSuffix={t('pricing.pass.day24')}
      benefits={benefits}
      onAction={onDayPass}
      actionLabel={actionLabel(t, dayPassPending, 'pricing.pass.getDayPass')}
      actionDisabled={dayPassPending}
    />
  );

  const weekCard = (
    <PricingCard
      key="week"
      title="Week Pass"
      {...featuredTreatment(t, featureWeek)}
      horizonCaption={showHorizons ? t('pricing.pass.horizonWeek') : undefined}
      price={prices['7d']}
      priceSuffix={t('pricing.pass.week1')}
      benefits={benefits}
      onAction={onWeekPass}
      actionLabel={actionLabel(t, weekPassPending, 'pricing.pass.getWeekPass')}
      actionDisabled={weekPassPending}
    />
  );

  const semesterCard =
    onSemesterPass == null ? null : (
      <PricingCard
        key="semester"
        title="Semester Pass"
        className={featureSemester ? styles.cardPro : undefined}
        badge={
          featureSemester
            ? t('pricing.pass.mostPopular')
            : t('pricing.pass.bestValue')
        }
        badgeMuted={!featureSemester}
        horizonCaption={t('pricing.pass.horizonSemester')}
        valueCaption={t('pricing.pass.semesterPerWeek')}
        price={prices['120d']}
        priceSuffix={t('pricing.pass.semester4mo')}
        benefits={benefits}
        onAction={onSemesterPass}
        actionLabel={actionLabel(
          t,
          semesterPassPending,
          'pricing.pass.getSemesterPass'
        )}
        actionDisabled={semesterPassPending}
      />
    );

  const cards = featureSemester
    ? [semesterCard, weekCard, dayCard]
    : [dayCard, weekCard, semesterCard];

  return <div className={styles.passGrid}>{cards}</div>;
}
