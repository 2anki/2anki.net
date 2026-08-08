import type { UserPassWindowRow } from '../../data_layer/UserPassRepository';
import type { AnonymousPassWindowRow } from '../../data_layer/AnonymousPassRepository';
import type { PaidValueEventRow } from '../../data_layer/EventsMetricsRepository';
import type { NewSubscriptionWithUserRow } from '../../data_layer/PaidValueSubscriptionsRepository';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const KIND_DURATION_MS: Record<string, number> = {
  '24h': DAY_MS,
  '7d': WEEK_MS,
};
const DEFAULT_KIND_DURATION_MS = DAY_MS;
const LARGEST_KIND_DURATION_MS = WEEK_MS;
const SUBSCRIPTION_VALUE_WINDOW_MS = WEEK_MS;

export type PaidValueClassification = 'tried' | 'never';

export interface PassValueRow {
  userId: number;
  kind: string;
  expiresAt: string;
  successes: number;
  downloads: number;
  failures: number;
  classification: PaidValueClassification;
}

export interface SubscriptionValueRow {
  userId: number;
  subscribedAt: string;
  successes: number;
  downloads: number;
  failures: number;
  classification: PaidValueClassification;
}

export interface PassValueGroup {
  checked: number;
  withValue: number;
  zeroValueTried: number;
  zeroValueNeverTried: number;
  rows: PassValueRow[];
}

export interface SubscriptionValueGroup {
  checked: number;
  withValue: number;
  zeroValueTried: number;
  zeroValueNeverTried: number;
  rows: SubscriptionValueRow[];
}

export interface PaidValueMonitorResponse {
  window_since: string;
  as_of: string;
  passes: PassValueGroup;
  claimedAnonymousPasses: PassValueGroup;
  unclaimedAnonymousPasses: number;
  newSubscriptions: SubscriptionValueGroup;
}

export interface UserPassWindowSource {
  listActiveInWindow(since: Date, until: Date): Promise<UserPassWindowRow[]>;
}

export interface AnonymousPassWindowSource {
  listActiveInWindow(
    since: Date,
    until: Date
  ): Promise<AnonymousPassWindowRow[]>;
}

export interface NewSubscriptionsSource {
  listNewWithUserId(
    since: Date,
    until: Date
  ): Promise<NewSubscriptionWithUserRow[]>;
}

export interface PaidValueEventsSource {
  listPaidValueEvents(
    userIds: number[],
    since: Date
  ): Promise<PaidValueEventRow[]>;
}

interface PaidValueMonitorServiceDeps {
  userPasses: UserPassWindowSource;
  anonymousPasses: AnonymousPassWindowSource;
  subscriptions: NewSubscriptionsSource;
  events: PaidValueEventsSource;
}

interface PassLikeUnit {
  userId: number;
  kind: string;
  expiresAt: Date;
  windowStart: Date;
  windowEnd: Date;
}

interface SubscriptionUnit {
  userId: number;
  subscribedAt: Date;
  windowStart: Date;
  windowEnd: Date;
}

interface EventCounts {
  successes: number;
  downloads: number;
  failures: number;
}

function kindDurationMs(kind: string): number {
  const known = KIND_DURATION_MS[kind];
  if (known != null) {
    return known;
  }
  console.warn(
    `[paid-value-monitor] unknown pass kind "${kind}" — defaulting to 24h window`
  );
  return DEFAULT_KIND_DURATION_MS;
}

function windowsIntersect(
  startMs: number,
  endMs: number,
  sinceMs: number,
  nowMs: number
): boolean {
  return startMs <= nowMs && endMs >= sinceMs;
}

function toPassUnit(row: UserPassWindowRow): PassLikeUnit {
  const duration = kindDurationMs(row.kind);
  return {
    userId: row.userId,
    kind: row.kind,
    expiresAt: row.expiresAt,
    windowStart: new Date(row.expiresAt.getTime() - duration),
    windowEnd: row.expiresAt,
  };
}

function toSubscriptionUnit(
  row: NewSubscriptionWithUserRow,
  now: Date
): SubscriptionUnit {
  const windowEndMs = Math.min(
    row.createdAt.getTime() + SUBSCRIPTION_VALUE_WINDOW_MS,
    now.getTime()
  );
  return {
    userId: row.userId,
    subscribedAt: row.createdAt,
    windowStart: row.createdAt,
    windowEnd: new Date(windowEndMs),
  };
}

function groupEventsByUser(
  events: PaidValueEventRow[]
): Map<number, PaidValueEventRow[]> {
  const byUser = new Map<number, PaidValueEventRow[]>();
  for (const event of events) {
    const existing = byUser.get(event.userId);
    if (existing == null) {
      byUser.set(event.userId, [event]);
    } else {
      existing.push(event);
    }
  }
  return byUser;
}

function countInWindow(
  events: PaidValueEventRow[] | undefined,
  windowStart: Date,
  windowEnd: Date
): EventCounts {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const counts: EventCounts = { successes: 0, downloads: 0, failures: 0 };
  for (const event of events ?? []) {
    const at = event.createdAt.getTime();
    if (at < startMs || at > endMs) {
      continue;
    }
    if (event.name === 'conversion_succeeded') {
      counts.successes += 1;
    } else if (event.name === 'deck_downloaded') {
      counts.downloads += 1;
    } else if (event.name === 'conversion_failed') {
      counts.failures += 1;
    }
  }
  return counts;
}

function classify(counts: EventCounts): 'withValue' | PaidValueClassification {
  if (counts.successes > 0 || counts.downloads > 0) {
    return 'withValue';
  }
  if (counts.failures > 0) {
    return 'tried';
  }
  return 'never';
}

interface ValueGroupCounts {
  checked: number;
  withValue: number;
  zeroValueTried: number;
  zeroValueNeverTried: number;
}

function accumulateUnit<TRow>(
  group: ValueGroupCounts & { rows: TRow[] },
  classification: 'withValue' | PaidValueClassification,
  buildRow: (classification: PaidValueClassification) => TRow
): void {
  group.checked += 1;
  if (classification === 'withValue') {
    group.withValue += 1;
    return;
  }
  if (classification === 'tried') {
    group.zeroValueTried += 1;
  } else {
    group.zeroValueNeverTried += 1;
  }
  group.rows.push(buildRow(classification));
}

function buildPassGroup(
  units: PassLikeUnit[],
  eventsByUser: Map<number, PaidValueEventRow[]>
): PassValueGroup {
  const group: PassValueGroup = {
    checked: 0,
    withValue: 0,
    zeroValueTried: 0,
    zeroValueNeverTried: 0,
    rows: [],
  };
  for (const unit of units) {
    const counts = countInWindow(
      eventsByUser.get(unit.userId),
      unit.windowStart,
      unit.windowEnd
    );
    accumulateUnit(group, classify(counts), (classification) => ({
      userId: unit.userId,
      kind: unit.kind,
      expiresAt: unit.expiresAt.toISOString(),
      successes: counts.successes,
      downloads: counts.downloads,
      failures: counts.failures,
      classification,
    }));
  }
  return group;
}

function buildSubscriptionGroup(
  units: SubscriptionUnit[],
  eventsByUser: Map<number, PaidValueEventRow[]>
): SubscriptionValueGroup {
  const group: SubscriptionValueGroup = {
    checked: 0,
    withValue: 0,
    zeroValueTried: 0,
    zeroValueNeverTried: 0,
    rows: [],
  };
  for (const unit of units) {
    const counts = countInWindow(
      eventsByUser.get(unit.userId),
      unit.windowStart,
      unit.windowEnd
    );
    accumulateUnit(group, classify(counts), (classification) => ({
      userId: unit.userId,
      subscribedAt: unit.subscribedAt.toISOString(),
      successes: counts.successes,
      downloads: counts.downloads,
      failures: counts.failures,
      classification,
    }));
  }
  return group;
}

export class PaidValueMonitorService {
  private readonly userPasses: UserPassWindowSource;
  private readonly anonymousPasses: AnonymousPassWindowSource;
  private readonly subscriptions: NewSubscriptionsSource;
  private readonly events: PaidValueEventsSource;

  constructor(deps: PaidValueMonitorServiceDeps) {
    this.userPasses = deps.userPasses;
    this.anonymousPasses = deps.anonymousPasses;
    this.subscriptions = deps.subscriptions;
    this.events = deps.events;
  }

  async getStatus(since: Date, now: Date): Promise<PaidValueMonitorResponse> {
    const sinceMs = since.getTime();
    const nowMs = now.getTime();
    const passUntil = new Date(nowMs + LARGEST_KIND_DURATION_MS);

    const [userPassRows, anonPassRows, subscriptionRows] = await Promise.all([
      this.userPasses.listActiveInWindow(since, passUntil),
      this.anonymousPasses.listActiveInWindow(since, now),
      this.subscriptions.listNewWithUserId(since, now),
    ]);

    const passUnits = userPassRows
      .map(toPassUnit)
      .filter((unit) =>
        windowsIntersect(
          unit.windowStart.getTime(),
          unit.windowEnd.getTime(),
          sinceMs,
          nowMs
        )
      );

    const claimedAnonUnits: PassLikeUnit[] = [];
    let unclaimedAnonymousPasses = 0;
    for (const row of anonPassRows) {
      const intersects = windowsIntersect(
        row.createdAt.getTime(),
        row.expiresAt.getTime(),
        sinceMs,
        nowMs
      );
      if (!intersects) {
        continue;
      }
      if (row.claimedByUserId == null) {
        unclaimedAnonymousPasses += 1;
        continue;
      }
      claimedAnonUnits.push({
        userId: row.claimedByUserId,
        kind: row.kind,
        expiresAt: row.expiresAt,
        windowStart: row.createdAt,
        windowEnd: row.expiresAt,
      });
    }

    const subscriptionUnits = subscriptionRows.map((row) =>
      toSubscriptionUnit(row, now)
    );

    const userIds = new Set<number>();
    let earliestStartMs = nowMs;
    for (const unit of [
      ...passUnits,
      ...claimedAnonUnits,
      ...subscriptionUnits,
    ]) {
      userIds.add(unit.userId);
      earliestStartMs = Math.min(earliestStartMs, unit.windowStart.getTime());
    }

    const events = await this.events.listPaidValueEvents(
      [...userIds],
      new Date(earliestStartMs)
    );
    const eventsByUser = groupEventsByUser(events);

    return {
      window_since: since.toISOString(),
      as_of: now.toISOString(),
      passes: buildPassGroup(passUnits, eventsByUser),
      claimedAnonymousPasses: buildPassGroup(claimedAnonUnits, eventsByUser),
      unclaimedAnonymousPasses,
      newSubscriptions: buildSubscriptionGroup(subscriptionUnits, eventsByUser),
    };
  }
}
