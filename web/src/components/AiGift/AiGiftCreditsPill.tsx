import { useTranslation } from 'react-i18next';
import { useAiGift } from '../../lib/hooks/useAiGift';
import { useAppLanguage } from '../../lib/i18n/useAppLanguage';
import { giftOfferOf } from '../../lib/backend/aiGift';
import { formatGiftDate } from './formatGiftDate';
import sharedStyles from '../../styles/shared.module.css';
import styles from './AiGiftCreditsPill.module.css';

function SignedInCreditsPill({ className }: Readonly<{ className?: string }>) {
  const { t } = useTranslation('aiGift');
  const language = useAppLanguage();
  const offer = giftOfferOf(useAiGift(true));
  if (offer == null || !offer.hasCredits) return null;
  const validity =
    offer.expiresAt == null
      ? t('pill.fromFirstUse', {
          count: offer.validDays,
          date: formatGiftDate(offer.endsAt, language),
        })
      : t('pill.until', { date: formatGiftDate(offer.expiresAt, language) });
  return (
    <span
      className={
        className == null ? styles.pill : `${styles.pill} ${className}`
      }
      title={validity}
    >
      <span className={styles.sparkle} aria-hidden="true">
        ✦
      </span>
      <span>{t('pill.credits', { count: offer.credits })}</span>
      <span className={sharedStyles.srOnly}>{validity}</span>
    </span>
  );
}

// Shown only while the server says this account's next upload runs on gift
// credits. A signed-out visitor never has them, so it sends no request.
export function AiGiftCreditsPill({
  signedIn,
  className,
}: Readonly<{ signedIn: boolean; className?: string }>) {
  return signedIn ? <SignedInCreditsPill className={className} /> : null;
}
