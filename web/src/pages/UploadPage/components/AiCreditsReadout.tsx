import { useTranslation } from 'react-i18next';
import { AiCreditsState } from '../../../lib/hooks/useAiCredits';
import type { AiGiftStatus } from '../../../lib/backend/aiGift';
import { BuyCreditsButton } from '../../../components/BuyCreditsButton/BuyCreditsButton';
import {
  spentPlanCreditsKey,
  useActiveGiftBalance,
  useGiftBalanceText,
} from '../../../components/AiGift/useAiGiftBalanceLine';
import pageStyles from '../UploadPage.module.css';

const LOW_CREDITS_THRESHOLD = 25;

interface Props {
  readonly credits: AiCreditsState | null;
  readonly gift?: AiGiftStatus | null;
}

export function AiCreditsReadout({ credits, gift = null }: Props) {
  const { t } = useTranslation('aicredits');
  const giftBalance = useActiveGiftBalance(gift);
  const giftLine = useGiftBalanceText(giftBalance, true);

  if (credits == null || credits.allowance === 0) {
    return null;
  }

  const giftReadout = giftLine != null && (
    <span className={pageStyles.aiCreditsLine} data-testid="ai-gift-credits">
      {giftLine}
    </span>
  );

  if (credits.credits <= 0) {
    return (
      <>
        <span className={pageStyles.aiCreditsLine} data-testid="ai-credits">
          <span className={pageStyles.aiCreditsWarning}>
            {t(spentPlanCreditsKey(credits, giftBalance != null))}
          </span>
          <BuyCreditsButton source="credits_badge" variant="link" compact />
        </span>
        {giftReadout}
      </>
    );
  }

  const low = credits.credits <= LOW_CREDITS_THRESHOLD;
  return (
    <>
      <span className={pageStyles.aiCreditsLine} data-testid="ai-credits">
        <span
          className={
            low ? pageStyles.aiCreditsWarning : pageStyles.aiCreditsCount
          }
        >
          {t('left', { count: credits.credits })}
        </span>
        {low && (
          <BuyCreditsButton source="credits_badge" variant="link" compact />
        )}
      </span>
      {giftReadout}
    </>
  );
}
