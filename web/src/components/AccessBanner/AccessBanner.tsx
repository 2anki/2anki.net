import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import styles from './AccessBanner.module.css';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;

function formatExpiryDate(date: Date, locale: string): string {
  return date.toLocaleString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function roundToNearest10Min(ms: number): number {
  return Math.round(ms / TEN_MINUTES_MS) * TEN_MINUTES_MS;
}

function formatTimeRemaining(ms: number, t: TFunction): string {
  const rounded = roundToNearest10Min(ms);
  const minutes = Math.floor(rounded / 60000);
  if (minutes < 60) {
    return t('accessBanner.minutes', { count: minutes });
  }
  const hours = Math.round(minutes / 60);
  return t('accessBanner.aboutHours', { count: hours });
}

type PassKind = '24h' | '7d' | '120d' | 'unlimited';

const PASS_LABELS: Record<PassKind, string> = {
  '24h': 'Day Pass',
  '7d': 'Week Pass',
  '120d': 'Semester Pass',
  unlimited: 'Unlimited',
};

interface AccessBannerProps {
  passExpiresAt: string | null | undefined;
  passKind: PassKind | null | undefined;
  now?: Date;
}

export function AccessBanner({
  passExpiresAt,
  passKind,
  now = new Date(),
}: Readonly<AccessBannerProps>) {
  const { t, i18n } = useTranslation('account');

  if (passExpiresAt == null || passKind == null) return null;

  const expiresAt = new Date(passExpiresAt);
  const remainingMs = expiresAt.getTime() - now.getTime();

  if (remainingMs <= 0) return null;

  const passLabel = PASS_LABELS[passKind];
  const locale = i18n.language.startsWith('de') ? 'de-DE' : 'en-GB';

  if (remainingMs >= TWO_HOURS_MS) {
    return (
      <output className={styles.banner}>
        <span className={styles.message}>
          {t('accessBanner.active', {
            passLabel,
            date: formatExpiryDate(expiresAt, locale),
          })}
        </span>
      </output>
    );
  }

  return (
    <output className={styles.banner}>
      <span className={styles.warning}>
        {t('accessBanner.endsIn', {
          passLabel,
          time: formatTimeRemaining(remainingMs, t),
        })}
      </span>
    </output>
  );
}
