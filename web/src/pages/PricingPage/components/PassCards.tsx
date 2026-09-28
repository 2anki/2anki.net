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

  const dayCard = (
    <PricingCard
      key="day"
      title="Day Pass"
      badge={featureDayPass ? t('pricing.pass.mostPopular') : undefined}
      horizonCaption={featureDayPass ? undefined : t('pricing.pass.horizonDay')}
      price={prices['24h']}
      priceSuffix={t('pricing.pass.day24')}
      benefits={benefits}
      onAction={onDayPass}
      actionLabel={
        dayPassPending
          ? t('pricing.pass.redirecting')
          : t('pricing.pass.getDayPass')
      }
      actionDisabled={dayPassPending}
      className={featureDayPass ? styles.cardPro : undefined}
    />
  );

  const weekCard = (
    <PricingCard
      key="week"
      title="Week Pass"
      badge={featureWeek ? t('pricing.pass.mostPopular') : undefined}
      horizonCaption={
        featureDayPass ? undefined : t('pricing.pass.horizonWeek')
      }
      price={prices['7d']}
      priceSuffix={t('pricing.pass.week1')}
      benefits={benefits}
      onAction={onWeekPass}
      actionLabel={
        weekPassPending
          ? t('pricing.pass.redirecting')
          : t('pricing.pass.getWeekPass')
      }
      actionDisabled={weekPassPending}
      className={featureWeek ? styles.cardPro : undefined}
    />
  );

  const semesterCard =
    onSemesterPass == null ? null : (
      <PricingCard
        key="semester"
        title="Semester Pass"
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
        actionLabel={
          semesterPassPending
            ? t('pricing.pass.redirecting')
            : t('pricing.pass.getSemesterPass')
        }
        actionDisabled={semesterPassPending}
        className={featureSemester ? styles.cardPro : undefined}
      />
    );

  const cards = featureSemester
    ? [semesterCard, weekCard, dayCard]
    : [dayCard, weekCard, semesterCard];

  return <div className={styles.passGrid}>{cards}</div>;
}
