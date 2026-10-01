export type { AiUsageGroup, AiUsageTotals } from '@server/types/ops/AiUsage';
export type { AiUsageMetricsPayload as AiUsageResponse } from '@server/types/ops/AiUsage';

export const AI_USAGE_WINDOWS = ['7d', '14d', '30d', '60d', '90d'] as const;

export type AiUsageWindow = (typeof AI_USAGE_WINDOWS)[number];

export const AI_SPEND_USER_ALERT_USD = 25;
