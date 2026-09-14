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
  current_period_start?: number | null;
  current_period_end?: number | null;
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
  // Newer webhook payloads moved current_period_* onto the item; older stored
  // rows still carry it at the top level. Read the item first, fall back to the
  // top level, and log when neither carries a period (the resolver then uses a
  // rolling window).
  const periodStart = toDate(
    item?.current_period_start ?? parsed?.current_period_start
  );
  const periodEnd = toDate(
    item?.current_period_end ?? parsed?.current_period_end
  );
  if (parsed != null && periodStart == null && periodEnd == null) {
    console.info(
      '[ai-credits] subscription payload carries no billing period; using a rolling window'
    );
  }
  return {
    periodStart,
    periodEnd,
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

    const [passWindow, subscriptionRow] = await Promise.all([
      new UserPassRepository(this.database).findActivePassWindow(userId, now),
      this.buildActiveSubscriptionQuery(user.email).first() as Promise<
        { payload: unknown } | undefined
      >,
    ]);

    return {
      pass:
        passWindow != null
          ? {
              kind: passWindow.kind,
              windowStart: passWindow.windowStart,
              windowEnd: passWindow.windowEnd,
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
