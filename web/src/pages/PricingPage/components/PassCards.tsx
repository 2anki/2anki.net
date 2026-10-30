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

interface PassCardProps {
  onSelect: () => void;
  pending: boolean;
  price: string;
  benefits: string[];
  featured?: boolean;
  showHorizon?: boolean;
}

export function DayPassCard({
  onSelect,
  pending,
  price,
  benefits,
  featured = false,
  showHorizon = true,
}: Readonly<PassCardProps>) {
  const { t } = useTranslation();
  return (
    <PricingCard
      title="Day Pass"
      badge={t('pricing.pass.mostPopular')}
      className={featuredClass(featured)}
      horizonCaption={showHorizon ? t('pricing.pass.horizonDay') : undefined}
      price={price}
      priceSuffix={t('pricing.pass.day24')}
      benefits={benefits}
      onAction={onSelect}
      actionLabel={
        pending
          ? t('pricing.pass.startingCheckout')
          : t('pricing.pass.getDayPass', { price })
      }
      actionDisabled={pending}
    />
  );
}

export function WeekPassCard({
  onSelect,
  pending,
  price,
  benefits,
  showHorizon = true,
}: Readonly<Omit<PassCardProps, 'featured'>>) {
  const { t } = useTranslation();
  return (
    <PricingCard
      title="Week Pass"
      horizonCaption={showHorizon ? t('pricing.pass.horizonWeek') : undefined}
      price={price}
      priceSuffix={t('pricing.pass.week1')}
      benefits={benefits}
      onAction={onSelect}
      actionLabel={
        pending
          ? t('pricing.pass.startingCheckout')
          : t('pricing.pass.getWeekPass', { price })
      }
      actionDisabled={pending}
    />
  );
}

export function SemesterPassCard({
  onSelect,
  pending,
  price,
  benefits,
  featured = false,
}: Readonly<Omit<PassCardProps, 'showHorizon'>>) {
  const { t } = useTranslation();
  return (
    <PricingCard
      title="Semester Pass"
      className={featuredClass(featured)}
      badge={t('pricing.pass.bestValue')}
      badgeMuted
      horizonCaption={t('pricing.pass.horizonSemester')}
      valueCaption={t('pricing.pass.semesterPerWeek')}
      price={price}
      priceSuffix={t('pricing.pass.semester4mo')}
      benefits={benefits}
      onAction={onSelect}
      actionLabel={
        pending
          ? t('pricing.pass.startingCheckout')
          : t('pricing.pass.getSemesterPass', { price })
      }
      actionDisabled={pending}
    />
  );
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

  const dayCard = (
    <DayPassCard
      key="day"
      onSelect={onDayPass}
      pending={dayPassPending}
      price={prices['24h']}
      benefits={cardBenefits}
      featured={featureDayPass}
      showHorizon={showHorizons}
    />
  );

  const weekCard = (
    <WeekPassCard
      key="week"
      onSelect={onWeekPass}
      pending={weekPassPending}
      price={prices['7d']}
      benefits={cardBenefits}
      showHorizon={showHorizons}
    />
  );

  const semesterCard =
    onSemesterPass == null ? null : (
      <SemesterPassCard
        key="semester"
        onSelect={onSemesterPass}
        pending={semesterPassPending}
        price={prices['120d']}
        benefits={cardBenefits}
        featured={featureSemester}
      />
    );

  const cards = featureSemester
    ? [semesterCard, weekCard, dayCard]
    : [dayCard, weekCard, semesterCard];

  return <div className={styles.passGrid}>{cards}</div>;
}
