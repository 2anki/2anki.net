import { useTranslation } from 'react-i18next';
import { PricingCard } from './PricingCard';
import { PASS_PRICES } from '../payment.links';
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
}

export function PassCards({
  onDayPass,
  onWeekPass,
  onSemesterPass,
  dayPassPending,
  weekPassPending,
  semesterPassPending = false,
  featureDayPass = true,
}: Readonly<PassCardsProps>) {
  const { t } = useTranslation();
  const benefits = PASS_BENEFIT_KEYS.map((key) => t(key));
  return (
    <div className={styles.passGrid}>
      <PricingCard
        title="Day Pass"
        badge={
          featureDayPass
            ? t('pricing.pass.mostPopular')
            : t('pricing.pass.payOnce')
        }
        badgeMuted={!featureDayPass}
        price="$4"
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
      <PricingCard
        title="Week Pass"
        price="$9"
        priceSuffix={t('pricing.pass.week1')}
        benefits={benefits}
        onAction={onWeekPass}
        actionLabel={
          weekPassPending
            ? t('pricing.pass.redirecting')
            : t('pricing.pass.getWeekPass')
        }
        actionDisabled={weekPassPending}
      />
      {onSemesterPass != null && (
        <PricingCard
          title="Semester Pass"
          price={PASS_PRICES['120d']}
          priceSuffix={t('pricing.pass.semester4mo')}
          benefits={benefits}
          onAction={onSemesterPass}
          actionLabel={
            semesterPassPending
              ? t('pricing.pass.redirecting')
              : t('pricing.pass.getSemesterPass')
          }
          actionDisabled={semesterPassPending}
        />
      )}
    </div>
  );
}
