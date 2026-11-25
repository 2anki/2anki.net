import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiGift } from '../../lib/hooks/useAiGift';
import { useAppLanguage } from '../../lib/i18n/useAppLanguage';
import type { AiGiftStatus } from '../../lib/backend/aiGift';
import type { AiCreditsState } from '../../lib/hooks/useAiCredits';
import { formatGiftDate } from './formatGiftDate';

const LONGEST_TIMER_MS = 2_147_483_647;

export interface ActiveGiftBalance {
  credits: number;
  expiresAt: string;
}

export function activeGiftBalance(
  gift: AiGiftStatus | null,
  now: number
): ActiveGiftBalance | null {
  if (gift?.state !== 'claimed' || gift.credits <= 0) return null;
  const expiresAt = Date.parse(gift.expiresAt);
  if (Number.isNaN(expiresAt) || expiresAt <= now) return null;
  return { credits: gift.credits, expiresAt: gift.expiresAt };
}

export function useActiveGiftBalance(
  gift: AiGiftStatus | null
): ActiveGiftBalance | null {
  const [now, setNow] = useState(() => Date.now());
  const balance = activeGiftBalance(gift, now);
  const expiresAt = balance == null ? null : Date.parse(balance.expiresAt);

  useEffect(() => {
    if (expiresAt == null) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(0, expiresAt - Date.now()), LONGEST_TIMER_MS)
    );
    return () => clearTimeout(timer);
  }, [expiresAt, now]);

  return balance;
}

export function useSignedInGiftBalance(
  signedIn: boolean
): ActiveGiftBalance | null {
  const gift = useAiGift(true);
  return useActiveGiftBalance(signedIn ? gift : null);
}

export function useGiftBalanceText(
  balance: ActiveGiftBalance | null,
  afterPlanLine: boolean
): string | null {
  const { t } = useTranslation('aiGift');
  const language = useAppLanguage();
  if (balance == null) return null;
  const values = {
    count: balance.credits,
    date: formatGiftDate(balance.expiresAt, language),
  };
  return afterPlanLine
    ? t('balanceAfterPlan', values)
    : t('balanceAlone', values);
}

export function spentPlanCreditsKey(
  credits: AiCreditsState,
  giftActive: boolean
): 'planZero' | 'zero' | 'zeroPass' {
  if (giftActive) return 'planZero';
  return credits.resets === 'pass' ? 'zeroPass' : 'zero';
}
