import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAiCredits,
  type AiCreditsState,
} from '../../../lib/hooks/useAiCredits';
import { BuyCreditsButton } from '../../../components/BuyCreditsButton/BuyCreditsButton';
import { useAiGiftBalanceLine } from '../../../components/AiGift/useAiGiftBalanceLine';
import { formatLongDate } from '../utils/formatLongDate';
import styles from '../AccountPage.module.css';

interface PlanLine {
  line: ReactNode;
  buy: boolean;
}

function usePlanLine(credits: AiCreditsState | null): PlanLine | null {
  const { t, i18n } = useTranslation('aicredits');

  if (credits == null) {
    return null;
  }

  if (!credits.usable) {
    if (credits.credits > 0 && credits.windowEnd != null) {
      const pausedThrough = formatLongDate(
        new Date(credits.windowEnd),
        i18n.language
      );
      return {
        line: (
          <p className={styles.planMeta}>
            {t('paused', { count: credits.credits, date: pausedThrough })}
          </p>
        ),
        buy: false,
      };
    }
    return null;
  }

  if (credits.credits <= 0) {
    return {
      line: <p className={styles.planMeta}>{t('planZero')}</p>,
      buy: true,
    };
  }

  // Only the calendar-month window ends on a UTC-midnight boundary, so format
  // that one in UTC to avoid a day-early reset west of UTC. The period and pass
  // windows carry the exact Stripe/pass timestamp, which is rendered in the
  // user's local time.
  const timeZone = credits.resets === 'month' ? 'UTC' : undefined;
  const validThrough =
    credits.windowEnd != null
      ? formatLongDate(new Date(credits.windowEnd), i18n.language, timeZone)
      : null;

  if (credits.used > 0) {
    return {
      line: (
        <p className={styles.planMeta}>
          <span className={styles.aiCreditsCount}>
            {t('usedThisPeriod', { count: credits.used })}
          </span>{' '}
          {validThrough != null
            ? t('remainingValid', {
                count: credits.credits,
                date: validThrough,
              })
            : t('remaining', { count: credits.credits })}
        </p>
      ),
      buy: false,
    };
  }

  return {
    line: (
      <p className={styles.planMeta}>
        <span className={styles.aiCreditsCount}>
          {validThrough != null
            ? t('planValid', {
                count: credits.credits,
                date: validThrough,
              })
            : t('plan', { count: credits.credits })}
        </span>
      </p>
    ),
    buy: true,
  };
}

export function AiCreditsAccountLine() {
  const credits = useAiCredits(true);
  const plan = usePlanLine(credits);
  const giftLine = useAiGiftBalanceLine(true, plan != null);

  if (plan == null && giftLine == null) {
    return null;
  }

  return (
    <>
      {plan?.line}
      {giftLine != null && <p className={styles.planMeta}>{giftLine}</p>}
      {plan?.buy === true && (
        <BuyCreditsButton source="credits_account" variant="secondary" />
      )}
    </>
  );
}
