import { post } from './api';
import { CONFLICT } from './http';
import { landingCampaignParams } from '../adClick';

const DAY_PASS_CREDIT_PATH = '/api/checkout/pass/120d/day-pass-credit';
const RETRYABLE_CONFLICT = 'day_pass_credit_checkout_open';

export interface DayPassCreditOffer {
  display: string;
  semesterDisplay: string;
  dayPassDisplay: string;
  endsAt: string;
  semesterStartsAt: string | null;
}

export type DayPassCreditCheckout =
  | { url: string }
  | { status: 'unavailable' | 'error' };

export const getDayPassCreditOffer =
  async (): Promise<DayPassCreditOffer | null> => {
    try {
      const response = await fetch(DAY_PASS_CREDIT_PATH, {
        credentials: 'include',
      });
      if (!response.ok) {
        return null;
      }
      const body = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (
        body?.eligible !== true ||
        typeof body.display !== 'string' ||
        typeof body.semesterDisplay !== 'string' ||
        typeof body.dayPassDisplay !== 'string' ||
        typeof body.endsAt !== 'string' ||
        (body.semesterStartsAt != null &&
          typeof body.semesterStartsAt !== 'string')
      ) {
        return null;
      }
      return {
        display: body.display,
        semesterDisplay: body.semesterDisplay,
        dayPassDisplay: body.dayPassDisplay,
        endsAt: body.endsAt,
        semesterStartsAt:
          typeof body.semesterStartsAt === 'string'
            ? body.semesterStartsAt
            : null,
      };
    } catch {
      return null;
    }
  };

export const startDayPassCreditCheckout =
  async (): Promise<DayPassCreditCheckout> => {
    try {
      const response = await post(DAY_PASS_CREDIT_PATH, {
        campaign: landingCampaignParams(),
      });
      const body = (await response.json().catch(() => null)) as {
        url?: unknown;
        code?: unknown;
      } | null;
      if (response.status === CONFLICT) {
        return body?.code === RETRYABLE_CONFLICT
          ? { status: 'error' }
          : { status: 'unavailable' };
      }
      if (!response.ok) {
        return { status: 'error' };
      }
      return typeof body?.url === 'string'
        ? { url: body.url }
        : { status: 'error' };
    } catch {
      return { status: 'error' };
    }
  };
