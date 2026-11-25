import { get, post } from './api';

export type AiGiftStatus =
  | { state: 'closed'; feedbackDue: boolean }
  | {
      state: 'open';
      credits: number;
      expiresIfClaimedNow: string;
      claimClosesAt: string;
      feedbackDue: boolean;
    }
  | { state: 'full'; feedbackDue: boolean }
  | {
      state: 'claimed';
      credits: number;
      expiresAt: string;
      feedbackDue: boolean;
      inUse?: boolean;
    };

export type AiGiftRefusal =
  | 'gift_closed'
  | 'gift_already_claimed'
  | 'gift_budget_full'
  | 'gift_ip_limit'
  | 'unknown';

export type AiGiftClaimResult =
  | { ok: true; credits: number; expiresAt: string }
  | { ok: false; reason: AiGiftRefusal };

export type AiGiftFeedbackAnswer = 'yes' | 'no' | 'dismissed';

const CLOSED: AiGiftStatus = { state: 'closed', feedbackDue: false };

const KNOWN_REFUSALS = new Set<AiGiftRefusal>([
  'gift_closed',
  'gift_already_claimed',
  'gift_budget_full',
  'gift_ip_limit',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

export function parseAiGiftStatus(data: unknown): AiGiftStatus {
  if (!isRecord(data)) return CLOSED;
  const feedbackDue = data.feedbackDue === true;
  if (
    data.state === 'open' &&
    typeof data.credits === 'number' &&
    typeof data.expiresIfClaimedNow === 'string' &&
    typeof data.claimClosesAt === 'string'
  ) {
    return {
      state: 'open',
      credits: data.credits,
      expiresIfClaimedNow: data.expiresIfClaimedNow,
      claimClosesAt: data.claimClosesAt,
      feedbackDue,
    };
  }
  if (data.state === 'full') {
    return { state: 'full', feedbackDue };
  }
  if (
    data.state === 'claimed' &&
    typeof data.credits === 'number' &&
    typeof data.expiresAt === 'string'
  ) {
    return {
      state: 'claimed',
      credits: data.credits,
      expiresAt: data.expiresAt,
      feedbackDue,
      inUse: data.inUse === true,
    };
  }
  return { state: 'closed', feedbackDue };
}

export const getAiGift = async (): Promise<AiGiftStatus> => {
  try {
    return parseAiGiftStatus(await get('/api/ai/gift', { redirect: false }));
  } catch {
    return CLOSED;
  }
};

function refusalOf(data: unknown): AiGiftRefusal {
  if (isRecord(data) && typeof data.code === 'string') {
    const code = data.code as AiGiftRefusal;
    return KNOWN_REFUSALS.has(code) ? code : 'unknown';
  }
  return 'unknown';
}

export const claimAiGift = async (): Promise<AiGiftClaimResult> => {
  try {
    const response = await post('/api/ai/gift/claim', {});
    const data: unknown = await response.json().catch(() => null);
    if (
      response.ok &&
      isRecord(data) &&
      typeof data.credits === 'number' &&
      typeof data.expiresAt === 'string'
    ) {
      return { ok: true, credits: data.credits, expiresAt: data.expiresAt };
    }
    return { ok: false, reason: refusalOf(data) };
  } catch {
    return { ok: false, reason: 'unknown' };
  }
};

export const sendAiGiftFeedback = async (
  answer: AiGiftFeedbackAnswer,
  comment: string
): Promise<boolean> => {
  try {
    const response = await post('/api/ai/gift/feedback', {
      answer,
      comment: answer === 'no' ? comment : '',
    });
    return response.ok;
  } catch {
    return false;
  }
};
