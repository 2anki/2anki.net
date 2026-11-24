import type { Knex } from 'knex';
import type { AiGiftGrant } from '../lib/claude/aiCredits/gift/giftBalance';
import {
  AI_GIFT_IP_WINDOW_MS,
  AI_GIFT_MAX_CLAIMS_PER_IP,
  giftBudgetHasRoom,
} from '../lib/claude/aiCredits/gift/giftTerms';

const AI_USAGE_EVENT = 'ai_usage_recorded';

// One constant key for pg_advisory_xact_lock: every claim takes it inside its
// transaction, so two claims never read the same exposure and both insert.
export const AI_GIFT_CLAIM_LOCK_KEY = 726_100_412;

export interface AiGiftClaimInput {
  userId: number;
  credits: number;
  claimedAt: Date;
  expiresAt: Date;
  ipHash: string | null;
}

export type AiGiftClaimRefusal =
  | 'gift_already_claimed'
  | 'gift_ip_limit'
  | 'gift_budget_full';

export type AiGiftClaimOutcome =
  | { ok: true; grant: AiGiftGrant }
  | { ok: false; reason: AiGiftClaimRefusal };

export interface IAiCreditGiftsRepository {
  findGrant(userId: number): Promise<AiGiftGrant | null>;
  giftCostSince(giftId: number, userId: number, since: Date): Promise<number>;
  exposureCredits(now: Date): Promise<number>;
  claim(input: AiGiftClaimInput): Promise<AiGiftClaimOutcome>;
}

interface GiftRow {
  id: number | string;
  user_id: number | string;
  credits: number | string;
  claimed_at: Date | string;
  expires_at: Date | string;
}

function toGrant(row: GiftRow): AiGiftGrant {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    credits: Number(row.credits),
    claimedAt: new Date(row.claimed_at),
    expiresAt: new Date(row.expires_at),
  };
}

export class AiCreditGiftsRepository implements IAiCreditGiftsRepository {
  private readonly table = 'ai_credit_gifts';

  constructor(private readonly database: Knex) {}

  buildFindGrantQuery(userId: number, db: Knex = this.database) {
    return db(this.table)
      .where('user_id', userId)
      .first('id', 'user_id', 'credits', 'claimed_at', 'expires_at');
  }

  async findGrant(userId: number): Promise<AiGiftGrant | null> {
    const row = (await this.buildFindGrantQuery(userId)) as GiftRow | undefined;
    return row == null ? null : toGrant(row);
  }

  // What the grant's owner is charged: calls the guard admitted on this
  // grant, stamped with its id, minus refusals Claude answered with nothing.
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
      .whereRaw("props->>'billable' is distinct from 'false'")
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
    const row = (await this.buildGiftCostQuery(giftId, userId, since).first()) as
      | { cost_usd: number | string }
      | undefined;
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

  async claim(input: AiGiftClaimInput): Promise<AiGiftClaimOutcome> {
    return this.database.transaction(async (trx) => {
      await trx.raw('select pg_advisory_xact_lock(?)', [
        AI_GIFT_CLAIM_LOCK_KEY,
      ]);
      const existing = (await this.buildFindGrantQuery(input.userId, trx)) as
        | GiftRow
        | undefined;
      if (existing != null) {
        return { ok: false, reason: 'gift_already_claimed' } as const;
      }
      if (input.ipHash != null) {
        const counted = (await this.buildIpClaimCountQuery(
          input.ipHash,
          input.claimedAt,
          trx
        ).first()) as { count: number | string } | undefined;
        if (Number(counted?.count ?? 0) >= AI_GIFT_MAX_CLAIMS_PER_IP) {
          return { ok: false, reason: 'gift_ip_limit' } as const;
        }
      }
      const exposure = await this.readExposure(input.claimedAt, trx);
      if (!giftBudgetHasRoom(exposure)) {
        return { ok: false, reason: 'gift_budget_full' } as const;
      }
      const [row] = (await trx(this.table)
        .insert({
          user_id: input.userId,
          credits: input.credits,
          claimed_at: input.claimedAt,
          expires_at: input.expiresAt,
          ip_hash: input.ipHash,
        })
        .returning([
          'id',
          'user_id',
          'credits',
          'claimed_at',
          'expires_at',
        ])) as GiftRow[];
      return { ok: true, grant: toGrant(row) } as const;
    });
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
// repository. Claims run one at a time through a promise chain, the way the
// advisory lock serializes them in Postgres.
export class InMemoryAiCreditGiftsRepository
  implements IAiCreditGiftsRepository
{
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
          s.at.getTime() >= since.getTime() &&
          s.billable !== false
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
      return sum + (active ? Math.max(gift.credits, spentCredits) : spentCredits);
    }, 0);
  }

  claim(input: AiGiftClaimInput): Promise<AiGiftClaimOutcome> {
    const next = this.queue.then(() => this.claimNow(input));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async claimNow(input: AiGiftClaimInput): Promise<AiGiftClaimOutcome> {
    await Promise.resolve();
    if (this.gifts.some((g) => g.userId === input.userId)) {
      return { ok: false, reason: 'gift_already_claimed' };
    }
    if (input.ipHash != null) {
      const since = input.claimedAt.getTime() - AI_GIFT_IP_WINDOW_MS;
      const fromIp = this.gifts.filter(
        (g) => g.ipHash === input.ipHash && g.claimedAt.getTime() > since
      ).length;
      if (fromIp >= AI_GIFT_MAX_CLAIMS_PER_IP) {
        return { ok: false, reason: 'gift_ip_limit' };
      }
    }
    const exposure = await this.exposureCredits(input.claimedAt);
    await Promise.resolve();
    if (!giftBudgetHasRoom(exposure)) {
      return { ok: false, reason: 'gift_budget_full' };
    }
    const grant: InMemoryGift = {
      id: this.gifts.length + 1,
      userId: input.userId,
      credits: input.credits,
      claimedAt: input.claimedAt,
      expiresAt: input.expiresAt,
      ipHash: input.ipHash,
    };
    this.gifts.push(grant);
    return { ok: true, grant: { ...grant } };
  }
}

export default AiCreditGiftsRepository;
