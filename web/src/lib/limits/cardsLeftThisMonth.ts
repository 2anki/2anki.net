interface MonthlyCardUsage {
  cards_used: number;
  cards_limit: number;
  unlimited: boolean;
  loading: boolean;
}

export function cardsLeftThisMonth(
  usage: MonthlyCardUsage | null
): number | null {
  if (usage == null || usage.loading) return null;
  if (usage.unlimited) return Number.POSITIVE_INFINITY;
  return Math.max(0, usage.cards_limit - usage.cards_used);
}
