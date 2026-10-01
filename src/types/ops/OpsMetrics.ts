export type OpsMetricsWindow = '1h' | '24h' | '7d';

export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';

export interface OpsMetricsBucketPoint {
  bucket: string;
  status_class: StatusClass;
  count: number;
}

export interface OpsMetricsRouteLatencyPoint {
  method: string;
  route: string;
  avg_ms: number;
  p95_ms: number;
  count: number;
}

export interface OpsMetricsOutboundPoint {
  bucket: string;
  service: string;
  count: number;
}

export interface OpsMetricsRouteErrorPoint {
  method: string;
  route: string;
  total: number;
  errors: number;
}

export interface OpsMetricsServiceErrorPoint {
  service: string;
  total: number;
  errors: number;
}

export interface OpsMetricsServiceLatencyPoint {
  service: string;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  count: number;
}

export interface OpsMetricsUnsupportedBlockPoint {
  block_type: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
}

export interface OpsMetricsConversionOutputPoint {
  source: string;
  decks: number;
  cards: number;
  empty_back_cards: number;
  first_seen: string;
  last_seen: string;
}

export interface OpsMetricsParsePathPoint {
  parse_path: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
}

export interface OpsMetricsResponse {
  window: OpsMetricsWindow;
  bucket_seconds: number;
  generated_at: string;
  inbound_volume: OpsMetricsBucketPoint[];
  route_latency: OpsMetricsRouteLatencyPoint[];
  outbound_volume: OpsMetricsOutboundPoint[];
  outbound_latency_by_service: OpsMetricsServiceLatencyPoint[];
  error_rate_by_route: OpsMetricsRouteErrorPoint[];
  error_rate_by_service: OpsMetricsServiceErrorPoint[];
  unsupported_blocks: OpsMetricsUnsupportedBlockPoint[];
  conversion_output: OpsMetricsConversionOutputPoint[];
  parse_path_signatures: OpsMetricsParsePathPoint[];
}
