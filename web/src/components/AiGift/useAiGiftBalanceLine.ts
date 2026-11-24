import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiGift } from '../../lib/hooks/useAiGift';
import { useAppLanguage } from '../../lib/i18n/useAppLanguage';
import type { AiGiftStatus } from '../../lib/backend/aiGift';
import { formatGiftDate } from './AiGiftPresent';

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

export function useGiftBalanceText(
  gift: AiGiftStatus | null,
  afterPlanLine: boolean
): string | null {
  const { t } = useTranslation('aiGift');
  const language = useAppLanguage();
  const [mountedAt] = useState(() => Date.now());
  const balance = activeGiftBalance(gift, mountedAt);
  if (balance == null) return null;
  const values = {
    count: balance.credits,
    date: formatGiftDate(balance.expiresAt, language),
  };
  return afterPlanLine
    ? t('balanceAfterPlan', values)
    : t('balanceAlone', values);
}

export function useAiGiftBalanceLine(
  signedIn: boolean,
  afterPlanLine: boolean
): string | null {
  const gift = useAiGift(true);
  return useGiftBalanceText(signedIn ? gift : null, afterPlanLine);
}
