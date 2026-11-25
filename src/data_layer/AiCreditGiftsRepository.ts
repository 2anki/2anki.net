import type { Knex } from 'knex';
import type { AiGiftGrant } from '../lib/claude/aiCredits/gift/giftBalance';
import {
  AI_GIFT_IP_WINDOW_MS,
  AI_GIFT_MAX_CLAIMS_PER_IP,
  giftBudgetHasRoom,
} from '../lib/claude/aiCredits/gift/giftTerms';
import { JOB_LOCK_KEYS } from './JobLockRepository';

const AI_USAGE_EVENT = 'ai_usage_recorded';

export interface AiGiftStartInput {
  userId: number;
  credits: number;
  startedAt: Date;
  expiresAt: Date;
  ipHash: string | null;
}

export type AiGiftStartRefusal = 'gift_ip_limit' | 'gift_budget_full';

export type AiGiftStartOutcome =
  | { ok: true; grant: AiGiftGrant; created: boolean }
  | { ok: false; reason: AiGiftStartRefusal };

export interface IAiCreditGiftsRepository {
  findGrant(userId: number): Promise<AiGiftGrant | null>;
  giftCostSince(giftId: number, userId: number, since: Date): Promise<number>;
  exposureCredits(now: Date): Promise<number>;
  networkGrantCount(ipHash: string, now: Date): Promise<number>;
  startGrant(input: AiGiftStartInput): Promise<AiGiftStartOutcome>;
  markFirstUse(giftId: number, at: Date, expiresAt: Date): Promise<boolean>;
  recordFeedbackAnswer(userId: number, at: Date): Promise<boolean>;
}

interface GiftRow {
  id: number | string;
  user_id: number | string;
  credits: number | string;
  claimed_at: Date | string;
  expires_at: Date | string;
  first_used_at?: Date | string | null;
  feedback_answered_at?: Date | string | null;
}

const GIFT_COLUMNS = [
  'id',
  'user_id',
  'credits',
  'claimed_at',
  'expires_at',
  'first_used_at',
  'feedback_answered_at',
];

function optionalDate(value: Date | string | null | undefined): Date | null {
  return value == null ? null : new Date(value);
}

function toGrant(row: GiftRow): AiGiftGrant {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    credits: Number(row.credits),
    claimedAt: new Date(row.claimed_at),
    expiresAt: new Date(row.expires_at),
    firstUsedAt: optionalDate(row.first_used_at),
    feedbackAnsweredAt: optionalDate(row.feedback_answered_at),
  };
}

export class AiCreditGiftsRepository implements IAiCreditGiftsRepository {
  private readonly table = 'ai_credit_gifts';

  constructor(private readonly database: Knex) {}

  buildFindGrantQuery(userId: number, db: Knex = this.database) {
    return db(this.table)
      .where('user_id', userId)
      .first(...GIFT_COLUMNS);
  }

  async findGrant(userId: number): Promise<AiGiftGrant | null> {
    const row = (await this.buildFindGrantQuery(userId)) as GiftRow | undefined;
    return row == null ? null : toGrant(row);
  }

  // What the grant's owner is charged: every call the guard admitted on this
  // grant, stamped with its id. Refusals count too: they still cost input
  // tokens, and the exposure query counts them the same way.
  buildGiftCostQuery(
    giftId: number,
    userId: number,
    since: Date
  ): Knex.QueryBuilder {
    return this.database('events')
      .where('name', AI_USAGE_EVENT)
      .where('user_id', userId)
      .where('created_at', '>=', since)
      .whereRaw("props->>'gift_id' = ?", [String(giftId)])
      .select(
        this.database.raw(
          "coalesce(sum((props->>'cost_usd')::numeric), 0) as cost_usd"
        )
      );
  }

  async giftCostSince(
    giftId: number,
    userId: number,
    since: Date
  ): Promise<number> {
    const row = (await this.buildGiftCostQuery(
      giftId,
      userId,
      since
    ).first()) as { cost_usd: number | string } | undefined;
    return Number(row?.cost_usd ?? 0);
  }

  // Exposure in credits: a grant that has not expired counts its whole amount
  // (or what it has cost, if in-flight calls took it past that); an expired
  // grant counts only what it cost. Cost here is every call recorded against
  // a grant, refusals included, because the cap is about what we pay.
  buildExposureQuery(now: Date, db: Knex = this.database): Knex.Raw {
    return db.raw(
      `select coalesce(sum(case when g.expires_at > ?
          then greatest(g.credits::numeric, coalesce(s.cost_usd, 0) / 0.01)
          else coalesce(s.cost_usd, 0) / 0.01 end), 0) as exposure
        from ai_credit_gifts g
        left join (
          select props->>'gift_id' as gift_id,
            sum((props->>'cost_usd')::numeric) as cost_usd
          from events
          where name = ?
            and props->>'gift_id' is not null
            and created_at >= (select coalesce(min(claimed_at), ?) from ai_credit_gifts)
          group by props->>'gift_id'
        ) s on s.gift_id = g.id::text`,
      [now, AI_USAGE_EVENT, now]
    );
  }

  private async readExposure(now: Date, db: Knex): Promise<number> {
    const result = (await this.buildExposureQuery(now, db)) as {
      rows?: Array<{ exposure: number | string | null }>;
    };
    return Number(result.rows?.[0]?.exposure ?? 0);
  }

  async exposureCredits(now: Date): Promise<number> {
    return this.readExposure(now, this.database);
  }

  buildIpClaimCountQuery(ipHash: string, now: Date, db: Knex = this.database) {
    return db(this.table)
      .where('ip_hash', ipHash)
      .where('claimed_at', '>', new Date(now.getTime() - AI_GIFT_IP_WINDOW_MS))
      .count({ count: '*' });
  }

  private async countFromNetwork(
    ipHash: string,
    now: Date,
    db: Knex
  ): Promise<number> {
    const counted = (await this.buildIpClaimCountQuery(
      ipHash,
      now,
      db
    ).first()) as { count: number | string } | undefined;
    return Number(counted?.count ?? 0);
  }

  async networkGrantCount(ipHash: string, now: Date): Promise<number> {
    return this.countFromNetwork(ipHash, now, this.database);
  }

  // One grant per account, made at its first upload the gift pays for. An
  // account that already has one gets it back unchanged, so two uploads racing
  // to make the first grant end with one row; the advisory lock makes the cap
  // and network reads and the insert one step across processes.
  async startGrant(input: AiGiftStartInput): Promise<AiGiftStartOutcome> {
    return this.database.transaction(async (trx) => {
      await trx.raw('select pg_advisory_xact_lock(?)', [
        JOB_LOCK_KEYS.aiGiftClaims,
      ]);
      const existing = (await this.buildFindGrantQuery(input.userId, trx)) as
        | GiftRow
        | undefined;
      if (existing != null) {
        return { ok: true, grant: toGrant(existing), created: false } as const;
      }
      if (
        input.ipHash != null &&
        (await this.countFromNetwork(input.ipHash, input.startedAt, trx)) >=
          AI_GIFT_MAX_CLAIMS_PER_IP
      ) {
        return { ok: false, reason: 'gift_ip_limit' } as const;
      }
      const exposure = await this.readExposure(input.startedAt, trx);
      if (!giftBudgetHasRoom(exposure)) {
        return { ok: false, reason: 'gift_budget_full' } as const;
      }
      const [row] = (await trx(this.table)
        .insert({
          user_id: input.userId,
          credits: input.credits,
          claimed_at: input.startedAt,
          expires_at: input.expiresAt,
          ip_hash: input.ipHash,
        })
        .returning(GIFT_COLUMNS)) as GiftRow[];
      return { ok: true, grant: toGrant(row), created: true } as const;
    });
  }

  buildMarkFirstUseQuery(
    giftId: number,
    at: Date,
    expiresAt: Date
  ): Knex.QueryBuilder {
    return this.database(this.table)
      .where('id', giftId)
      .whereNull('first_used_at')
      .update({ first_used_at: at, expires_at: expiresAt })
      .returning('id');
  }

  // Only the first call finds first_used_at empty, so the clock starts once
  // however many calls of the first conversion run at the same moment.
  async markFirstUse(
    giftId: number,
    at: Date,
    expiresAt: Date
  ): Promise<boolean> {
    const updated = (await this.buildMarkFirstUseQuery(
      giftId,
      at,
      expiresAt
    )) as unknown[];
    return updated.length > 0;
  }

  buildRecordFeedbackQuery(userId: number, at: Date): Knex.QueryBuilder {
    return this.database(this.table)
      .where('user_id', userId)
      .whereNull('feedback_answered_at')
      .update({ feedback_answered_at: at })
      .returning('id');
  }

  // One answer per gift: only the first update finds the column empty, so a
  // second request, however close, updates nothing and reports false.
  async recordFeedbackAnswer(userId: number, at: Date): Promise<boolean> {
    const updated = (await this.buildRecordFeedbackQuery(
      userId,
      at
    )) as unknown[];
    return updated.length > 0;
  }
}

interface InMemoryGift extends AiGiftGrant {
  ipHash: string | null;
}

export interface InMemoryGiftSpend {
  giftId: number;
  userId: number;
  costUsd: number;
  at: Date;
  billable?: boolean;
}

// A stand-in for route and use case tests, with the same rules as the SQL
// repository. New grants run one at a time through a promise chain, the way
// the advisory lock serializes them in Postgres.
export class InMemoryAiCreditGiftsRepository implements IAiCreditGiftsRepository {
  readonly gifts: InMemoryGift[] = [];
  readonly spend: InMemoryGiftSpend[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  async findGrant(userId: number): Promise<AiGiftGrant | null> {
    const gift = this.gifts.find((g) => g.userId === userId);
    return gift == null ? null : { ...gift };
  }

  async giftCostSince(
    giftId: number,
    userId: number,
    since: Date
  ): Promise<number> {
    return this.spend
      .filter(
        (s) =>
          s.giftId === giftId &&
          s.userId === userId &&
          s.at.getTime() >= since.getTime()
      )
      .reduce((sum, s) => sum + s.costUsd, 0);
  }

  async exposureCredits(now: Date): Promise<number> {
    return this.gifts.reduce((sum, gift) => {
      const cost = this.spend
        .filter((s) => s.giftId === gift.id)
        .reduce((total, s) => total + s.costUsd, 0);
      const spentCredits = cost / 0.01;
      const active = gift.expiresAt.getTime() > now.getTime();
      return (
        sum + (active ? Math.max(gift.credits, spentCredits) : spentCredits)
      );
    }, 0);
  }

  async networkGrantCount(ipHash: string, now: Date): Promise<number> {
    const since = now.getTime() - AI_GIFT_IP_WINDOW_MS;
    return this.gifts.filter(
      (g) => g.ipHash === ipHash && g.claimedAt.getTime() > since
    ).length;
  }

  startGrant(input: AiGiftStartInput): Promise<AiGiftStartOutcome> {
    const next = this.queue.then(() => this.startNow(input));
    this.queue = next.catch(() => undefined);
    return next;
  }

  async markFirstUse(
    giftId: number,
    at: Date,
    expiresAt: Date
  ): Promise<boolean> {
    await Promise.resolve();
    const gift = this.gifts.find((g) => g.id === giftId);
    if (gift == null || gift.firstUsedAt != null) return false;
    gift.firstUsedAt = at;
    gift.expiresAt = expiresAt;
    return true;
  }

  async recordFeedbackAnswer(userId: number, at: Date): Promise<boolean> {
    const gift = this.gifts.find((g) => g.userId === userId);
    if (gift == null || gift.feedbackAnsweredAt != null) return false;
    gift.feedbackAnsweredAt = at;
    return true;
  }

  private async startNow(input: AiGiftStartInput): Promise<AiGiftStartOutcome> {
    await Promise.resolve();
    const existing = this.gifts.find((g) => g.userId === input.userId);
    if (existing != null) {
      return { ok: true, grant: { ...existing }, created: false };
    }
    if (
      input.ipHash != null &&
      (await this.networkGrantCount(input.ipHash, input.startedAt)) >=
        AI_GIFT_MAX_CLAIMS_PER_IP
    ) {
      return { ok: false, reason: 'gift_ip_limit' };
    }
    const exposure = await this.exposureCredits(input.startedAt);
    await Promise.resolve();
    if (!giftBudgetHasRoom(exposure)) {
      return { ok: false, reason: 'gift_budget_full' };
    }
    const grant: InMemoryGift = {
      id: this.gifts.length + 1,
      userId: input.userId,
      credits: input.credits,
      claimedAt: input.startedAt,
      expiresAt: input.expiresAt,
      firstUsedAt: null,
      feedbackAnsweredAt: null,
      ipHash: input.ipHash,
    };
    this.gifts.push(grant);
    return { ok: true, grant: { ...grant }, created: true };
  }
}

export default AiCreditGiftsRepository;
