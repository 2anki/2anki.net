import { IObservabilityRepository } from '../../data_layer/ObservabilityRepository';
import { IUnsupportedNotionBlockRepository } from '../../data_layer/UnsupportedNotionBlockRepository';
import { IConversionOutputStatsRepository } from '../../data_layer/ConversionOutputStatsRepository';
import { IParsePathSignatureRepository } from '../../data_layer/ParsePathSignatureRepository';

import type {
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
} from '../../types/ops/OpsMetrics';

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
};

export const OPS_METRICS_WINDOWS: readonly OpsMetricsWindow[] = [
  '1h',
  '24h',
  '7d',
];

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export const OPS_METRICS_RANGE_MS_BY_WINDOW: Record<OpsMetricsWindow, number> =
  {
    '1h': ONE_HOUR_MS,
    '24h': ONE_DAY_MS,
    '7d': 7 * ONE_DAY_MS,
  };

export const OPS_METRICS_BUCKET_SECONDS_BY_WINDOW: Record<
  OpsMetricsWindow,
  number
> = {
  '1h': 60,
  '24h': 5 * 60,
  '7d': 60 * 60,
};

const TOP_ROUTES_LIMIT = 15;
const TOP_ROUTES_ERROR_LIMIT = 10;
const TOP_SERVICES_ERROR_LIMIT = 5;
const TOP_SERVICES_LATENCY_LIMIT = 10;

export const isOpsMetricsWindow = (input: unknown): input is OpsMetricsWindow =>
  typeof input === 'string' &&
  (OPS_METRICS_WINDOWS as readonly string[]).includes(input);

export class ObservabilityQueryService {
  constructor(
    private readonly repository: IObservabilityRepository,
    private readonly unsupportedBlockRepository?: IUnsupportedNotionBlockRepository,
    private readonly conversionOutputStatsRepository?: IConversionOutputStatsRepository,
    private readonly parsePathSignatureRepository?: IParsePathSignatureRepository
  ) {}

  async getMetrics(window: OpsMetricsWindow): Promise<OpsMetricsResponse> {
    if (!isOpsMetricsWindow(window)) {
      throw new Error(`Unsupported window: ${String(window)}`);
    }
    const rangeMs = OPS_METRICS_RANGE_MS_BY_WINDOW[window];
    const bucketSeconds = OPS_METRICS_BUCKET_SECONDS_BY_WINDOW[window];
    const fromTime = new Date(Date.now() - rangeMs);

    const [
      inbound,
      latency,
      outbound,
      outboundLatency,
      routeErrors,
      serviceErrors,
      unsupportedBlocks,
      conversionOutput,
      parsePathSignatures,
    ] = await Promise.all([
      this.repository.aggregateInboundByStatusClass(fromTime, bucketSeconds),
      this.repository.topRoutesByLatency(fromTime, TOP_ROUTES_LIMIT),
      this.repository.aggregateOutboundByService(fromTime, bucketSeconds),
      this.repository.outboundLatencyByService(
        fromTime,
        TOP_SERVICES_LATENCY_LIMIT
      ),
      this.repository.errorRateByRoute(fromTime, TOP_ROUTES_ERROR_LIMIT),
      this.repository.errorRateByService(fromTime, TOP_SERVICES_ERROR_LIMIT),
      this.unsupportedBlockRepository?.list() ?? Promise.resolve([]),
      this.conversionOutputStatsRepository?.list() ?? Promise.resolve([]),
      this.parsePathSignatureRepository?.list() ?? Promise.resolve([]),
    ]);

    return {
      window,
      bucket_seconds: bucketSeconds,
      generated_at: new Date().toISOString(),
      inbound_volume: inbound.map((row) => ({
        bucket: row.bucket.toISOString(),
        status_class: row.status_class,
        count: row.count,
      })),
      route_latency: latency.map((row) => ({
        method: row.method,
        route: row.route,
        avg_ms: row.avg_ms,
        p95_ms: row.p95_ms,
        count: row.count,
      })),
      outbound_volume: outbound.map((row) => ({
        bucket: row.bucket.toISOString(),
        service: row.service,
        count: row.count,
      })),
      outbound_latency_by_service: outboundLatency.map((row) => ({
        service: row.service,
        p50_ms: row.p50_ms,
        p95_ms: row.p95_ms,
        p99_ms: row.p99_ms,
        count: row.count,
      })),
      error_rate_by_route: routeErrors.map((row) => ({
        method: row.method,
        route: row.route,
        total: row.total,
        errors: row.errors,
      })),
      error_rate_by_service: serviceErrors.map((row) => ({
        service: row.service,
        total: row.total,
        errors: row.errors,
      })),
      unsupported_blocks: unsupportedBlocks.map((row) => ({
        block_type: row.block_type,
        occurrences: row.occurrences,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
      })),
      conversion_output: conversionOutput.map((row) => ({
        source: row.source,
        decks: row.decks,
        cards: row.cards,
        empty_back_cards: row.empty_back_cards,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
      })),
      parse_path_signatures: parsePathSignatures.map((row) => ({
        parse_path: row.parse_path,
        occurrences: row.occurrences,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
      })),
    };
  }
}

export default ObservabilityQueryService;
