import { get } from './api';

export type AiCreditsReset = 'period' | 'pass' | 'month';

export interface AiCreditsResponse {
  credits: number;
  used: number;
  allowance: number;
  usable: boolean;
  windowEnd: string | null;
  resets: AiCreditsReset;
}

export const getAiCredits = async (): Promise<AiCreditsResponse | null> => {
  try {
    const data = await get('/api/ai/credits');
    if (
      data &&
      typeof data.credits === 'number' &&
      typeof data.allowance === 'number'
    ) {
      return { ...data, usable: data.usable === true } as AiCreditsResponse;
    }
    return null;
  } catch {
    return null;
  }
};
