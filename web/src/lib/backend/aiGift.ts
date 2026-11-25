import { get, post } from './api';

interface GiftNextUpload {
  claudeDefaultForPdf?: boolean | null;
  aiBudgetAvailable?: boolean | null;
  storedPdfSkipsClaude?: boolean | null;
  monthlyCardsLeft?: number | null;
  nextUploadUsesCredits?: boolean | null;
  switchOnByDefault?: boolean | null;
}

// hasCredits is the server's answer to whether this account's next upload
// runs on gift credits; the page shows the offer from it and never works it
// out on its own.
export type AiGiftStatus =
  | { state: 'closed'; feedbackDue: boolean }
  | (GiftNextUpload & {
      state: 'open';
      credits: number;
      hasCredits: boolean;
      validDays: number;
      endsAt: string;
      feedbackDue: boolean;
      minMonthlyCards?: number;
    })
  | { state: 'full'; feedbackDue: boolean }
  | (GiftNextUpload & {
      state: 'claimed';
      credits: number;
      hasCredits?: boolean;
      expiresAt: string;
      firstUsed?: boolean;
      validDays?: number;
      endsAt?: string;
      feedbackDue: boolean;
      inUse?: boolean;
      minMonthlyCards?: number;
    });

export type AiGiftFeedbackAnswer = 'yes' | 'no' | 'dismissed';

const CLOSED: AiGiftStatus = { state: 'closed', feedbackDue: false };

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

function nextUploadOf(data: Record<string, unknown>): GiftNextUpload {
  return {
    claudeDefaultForPdf: optionalBoolean(data.claudeDefaultForPdf),
    aiBudgetAvailable: optionalBoolean(data.aiBudgetAvailable),
    storedPdfSkipsClaude: optionalBoolean(data.storedPdfSkipsClaude),
    monthlyCardsLeft: optionalCount(data.monthlyCardsLeft) ?? null,
    nextUploadUsesCredits: optionalBoolean(data.nextUploadUsesCredits),
    switchOnByDefault: optionalBoolean(data.switchOnByDefault),
  };
}

function hasTerms(data: Record<string, unknown>): boolean {
  return (
    typeof data.credits === 'number' &&
    typeof data.validDays === 'number' &&
    typeof data.endsAt === 'string'
  );
}

export function parseAiGiftStatus(data: unknown): AiGiftStatus {
  if (!isRecord(data)) return CLOSED;
  const feedbackDue = data.feedbackDue === true;
  if (data.state === 'open' && hasTerms(data)) {
    return {
      state: 'open',
      credits: data.credits as number,
      hasCredits: data.hasCredits === true,
      validDays: data.validDays as number,
      endsAt: data.endsAt as string,
      feedbackDue,
      minMonthlyCards: optionalCount(data.minMonthlyCards),
      ...nextUploadOf(data),
    };
  }
  if (data.state === 'full') {
    return { state: 'full', feedbackDue };
  }
  if (
    data.state === 'claimed' &&
    hasTerms(data) &&
    typeof data.expiresAt === 'string'
  ) {
    return {
      state: 'claimed',
      credits: data.credits as number,
      hasCredits: data.hasCredits === true,
      expiresAt: data.expiresAt,
      firstUsed: data.firstUsed === true,
      validDays: data.validDays as number,
      endsAt: data.endsAt as string,
      feedbackDue,
      inUse: data.inUse === true,
      minMonthlyCards: optionalCount(data.minMonthlyCards),
      ...nextUploadOf(data),
    };
  }
  return { state: 'closed', feedbackDue };
}

// The gift as the upload card offers it, every answer the server's: whether
// this visitor holds or can get credits, whether the next upload can use
// them now, and where the card's switch starts.
export interface GiftOffer {
  credits: number;
  hasCredits: boolean;
  usableNow: boolean;
  switchOnByDefault: boolean;
  monthlyCardsLeft: number | null;
  minMonthlyCards: number | null;
  inUse: boolean;
  validDays: number;
  endsAt: string;
  expiresAt: string | null;
}

function nextUploadOffer(
  status: GiftNextUpload & { minMonthlyCards?: number }
) {
  return {
    usableNow: status.nextUploadUsesCredits === true,
    switchOnByDefault: status.switchOnByDefault === true,
    monthlyCardsLeft: status.monthlyCardsLeft ?? null,
    minMonthlyCards: status.minMonthlyCards ?? null,
  };
}

export function giftOfferOf(status: AiGiftStatus | null): GiftOffer | null {
  if (status == null) return null;
  if (status.state === 'open') {
    return {
      credits: status.credits,
      hasCredits: status.hasCredits,
      validDays: status.validDays,
      endsAt: status.endsAt,
      expiresAt: null,
      inUse: false,
      ...nextUploadOffer(status),
    };
  }
  if (
    status.state === 'claimed' &&
    status.hasCredits === true &&
    status.validDays != null &&
    status.endsAt != null
  ) {
    return {
      credits: status.credits,
      hasCredits: true,
      validDays: status.validDays,
      endsAt: status.endsAt,
      expiresAt: status.firstUsed === true ? status.expiresAt : null,
      inUse: status.inUse === true,
      ...nextUploadOffer(status),
    };
  }
  return null;
}

export const getAiGift = async (): Promise<AiGiftStatus> => {
  try {
    return parseAiGiftStatus(await get('/api/ai/gift', { redirect: false }));
  } catch {
    return CLOSED;
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
