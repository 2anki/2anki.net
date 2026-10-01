import type {
  OpsMetricsWindow,
  StatusClass,
} from '@server/types/ops/OpsMetrics';

export type {
  OpsMetricsBucketPoint,
  OpsMetricsConversionOutputPoint,
  OpsMetricsOutboundPoint,
  OpsMetricsParsePathPoint,
  OpsMetricsResponse,
  OpsMetricsRouteErrorPoint,
  OpsMetricsRouteLatencyPoint,
  OpsMetricsServiceErrorPoint,
  OpsMetricsServiceLatencyPoint,
  OpsMetricsUnsupportedBlockPoint,
  OpsMetricsWindow,
  StatusClass,
} from '@server/types/ops/OpsMetrics';

export const OPS_METRICS_WINDOWS: readonly OpsMetricsWindow[] = [
  '1h',
  '24h',
  '7d',
];

export const SERVICE_COLORS: Record<string, string> = {
  notion: '#000000',
  claude: '#d97706',
  dropbox: '#0061ff',
  google_drive: '#0f9d58',
  patreon: '#f1465a',
};

export const STATUS_CLASS_COLORS: Record<StatusClass, string> = {
  '2xx': '#10b981',
  '3xx': '#9ca3af',
  '4xx': '#f59e0b',
  '5xx': '#dc2626',
};
