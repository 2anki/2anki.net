import type { Knex } from 'knex';
import {
  PlanInputs,
  SubscriptionPlanInputs,
} from '../lib/claude/aiCredits/allowance';
import UserPassRepository from './UserPassRepository';

export interface IAiCreditsPlanReader {
  getPlanInputs(userId: number, now: Date): Promise<PlanInputs | null>;
}

interface StripePayloadShape {
  items?: {
    data?: Array<{
      current_period_start?: number | null;
      current_period_end?: number | null;
      price?: { unit_amount?: number | null } | null;
    }>;
  };
}

function toDate(epochSeconds: number | null | undefined): Date | null {
  if (typeof epochSeconds !== 'number' || Number.isNaN(epochSeconds)) {
    return null;
  }
  return new Date(epochSeconds * 1000);
}

export function parseSubscriptionPayload(
  payload: unknown
): SubscriptionPlanInputs {
  let parsed: StripePayloadShape | null = null;
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload) as StripePayloadShape;
    } catch {
      parsed = null;
    }
  } else if (payload != null && typeof payload === 'object') {
    parsed = payload as StripePayloadShape;
  }
  const item = parsed?.items?.data?.[0];
  const unitAmount = item?.price?.unit_amount;
  return {
    active: true,
    periodStart: toDate(item?.current_period_start),
    periodEnd: toDate(item?.current_period_end),
    unitAmount: typeof unitAmount === 'number' ? unitAmount : null,
  };
}

export class AiCreditsRepository implements IAiCreditsPlanReader {
  constructor(private readonly database: Knex) {}

  buildActiveSubscriptionQuery(email: string): Knex.QueryBuilder {
    const normalized = email.toLowerCase();
    return this.database('subscriptions')
      .where(function whereEmail() {
        this.where({ linked_email: normalized }).orWhere({ email: normalized });
      })
      .andWhere({ active: true })
      .orderBy('updated_at', 'desc')
      .select('payload');
  }

  async getPlanInputs(userId: number, now: Date): Promise<PlanInputs | null> {
    const user = (await this.database('users')
      .where({ id: userId })
      .first('email', 'patreon', 'ankify_access')) as
      | {
          email: string;
          patreon: boolean | null;
          ankify_access: boolean | null;
        }
      | undefined;
    if (user == null) {
      return null;
    }

    const passWindow = await new UserPassRepository(
      this.database
    ).findActivePassWindow(userId, now);

    const subscriptionRow = (await this.buildActiveSubscriptionQuery(
      user.email
    ).first()) as { payload: unknown } | undefined;

    return {
      pass:
        passWindow != null
          ? {
              kind: passWindow.kind,
              earliestExpiresAt: passWindow.earliestExpiresAt,
              latestExpiresAt: passWindow.latestExpiresAt,
            }
          : null,
      subscription:
        subscriptionRow != null
          ? parseSubscriptionPayload(subscriptionRow.payload)
          : null,
      patreon: user.patreon === true,
      ankifyAccess: user.ankify_access === true,
    };
  }
}

export default AiCreditsRepository;
