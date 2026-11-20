export interface MonthlyLimitUsage {
  readonly cards_used: number;
  readonly limit: number;
  readonly reset_on: string;
}

export interface MonthlyLimitRefusalBody extends MonthlyLimitUsage {
  readonly code: 'monthly_limit';
}

export function monthlyLimitRefusalBody(
  usage: MonthlyLimitUsage
): MonthlyLimitRefusalBody {
  return {
    code: 'monthly_limit',
    cards_used: usage.cards_used,
    limit: usage.limit,
    reset_on: usage.reset_on,
  };
}

export function monthlyLimitWallPath(usage: MonthlyLimitUsage): string {
  const query = new URLSearchParams({
    kind: 'card_count',
    used: String(usage.cards_used),
    limit: String(usage.limit),
    reset_on: usage.reset_on,
  });
  return `/limit?${query.toString()}`;
}
