import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import {
  OPS_METRICS_WINDOWS,
  OpsMetricsResponse,
  OpsMetricsWindow,
} from './opsTypes';
import { formatBytes, formatCount } from './opsHelpers';
import { buildClaudePrompt } from './buildClaudePrompt';
import CopyForClaudeButton from './CopyForClaudeButton';
import { useOpsMetrics } from './useOpsMetrics';
import { useMindmapStorage } from './useMindmapStorage';
import { MindmapStorageMetricsResponse } from './mindmapOpsTypes';
import MetricCard from './MetricCard';
import ChartPanel from './charts/ChartPanel';
import InboundVolumeChart from './charts/InboundVolumeChart';
import LatencyByRouteChart from './charts/LatencyByRouteChart';
import OutboundByServiceChart from './charts/OutboundByServiceChart';
import OutboundLatencyTable from './charts/OutboundLatencyTable';
import ErrorRateChart from './charts/ErrorRateChart';
import UnsupportedBlocksTable from './charts/UnsupportedBlocksTable';
import ConversionOutputTable from './charts/ConversionOutputTable';
import ParsePathSignaturesTable from './charts/ParsePathSignaturesTable';

export const ENGINEERING_WINDOW_PARAM = 'eng_window';

const WINDOW_LABEL: Record<OpsMetricsWindow, string> = {
  '1h': 'Last 1 hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
};

const WINDOW_CHART_SUFFIX: Record<OpsMetricsWindow, string> = {
  '1h': 'last 1h',
  '24h': 'last 24h',
  '7d': 'last 7d',
};

const isMetricsWindow = (value: string | null): value is OpsMetricsWindow =>
  value != null && (OPS_METRICS_WINDOWS as readonly string[]).includes(value);

const hasAnyData = (response: OpsMetricsResponse | undefined): boolean => {
  if (response == null) return false;
  return (
    response.inbound_volume.length > 0 ||
    response.route_latency.length > 0 ||
    response.outbound_volume.length > 0 ||
    (response.outbound_latency_by_service?.length ?? 0) > 0 ||
    response.error_rate_by_route.length > 0 ||
    response.error_rate_by_service.length > 0 ||
    (response.unsupported_blocks?.length ?? 0) > 0 ||
    (response.conversion_output?.length ?? 0) > 0 ||
    (response.parse_path_signatures?.length ?? 0) > 0
  );
};

const resolveStorageFootnote = (
  error: Error | null,
  data: MindmapStorageMetricsResponse | undefined
): string | undefined => {
  if (error != null) {
    return `/api/ops/mindmap/storage failed: ${error.message}`;
  }
  if (data == null) return undefined;
  return `${formatCount(data.total_objects)} objects`;
};

export default function EngineeringTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryWindow = searchParams.get(ENGINEERING_WINDOW_PARAM);
  const window: OpsMetricsWindow = isMetricsWindow(queryWindow)
    ? queryWindow
    : '24h';

  const [lastSnapshot, setLastSnapshot] = useState<OpsMetricsResponse | null>(
    null
  );

  const { data, error, isLoading } = useOpsMetrics(window);
  const mindmapStorage = useMindmapStorage();

  useEffect(() => {
    if (data != null) {
      setLastSnapshot(data);
    }
  }, [data]);

  const onWindowChange = (next: OpsMetricsWindow) => {
    const params = new URLSearchParams(searchParams);
    params.set(ENGINEERING_WINDOW_PARAM, next);
    setSearchParams(params, { replace: true });
  };

  const visible = data ?? lastSnapshot;
  const showInitialSkeleton = isLoading && visible == null;
  const isEmpty = visible != null && !hasAnyData(visible);
  const suffix = WINDOW_CHART_SUFFIX[window];

  const storageValue =
    mindmapStorage.data == null
      ? '—'
      : formatBytes(mindmapStorage.data.total_bytes);
  const storageFootnote = resolveStorageFootnote(
    mindmapStorage.error,
    mindmapStorage.data
  );

  return (
    <>
      <div className={styles.tabHeader}>
        <div className={styles.controls}>
          <label className={styles.controlsLabel} htmlFor="ops-window">
            Window
          </label>
          <select
            id="ops-window"
            className={`${sharedStyles.select} ${styles.windowSelect}`}
            value={window}
            onChange={(event) =>
              onWindowChange(event.target.value as OpsMetricsWindow)
            }
          >
            {OPS_METRICS_WINDOWS.map((value) => (
              <option key={value} value={value}>
                {WINDOW_LABEL[value]}
              </option>
            ))}
          </select>
          <CopyForClaudeButton
            getText={() =>
              visible == null ? '' : buildClaudePrompt('engineering', visible)
            }
            disabled={visible == null}
          />
        </div>
      </div>

      {error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          /api/ops/metrics failed: {error.message}. Last good data shown below.
        </div>
      )}

      {isEmpty && !showInitialSkeleton && (
        <div className={`${sharedStyles.notificationInfo} ${styles.banner}`}>
          No data yet. Make a request — it&rsquo;ll show up within 5 seconds.
        </div>
      )}

      <section className={styles.section} aria-labelledby="ops-section-inbound">
        <header className={styles.sectionHeader}>
          <h2 id="ops-section-inbound" className={styles.sectionTitle}>
            Inbound
          </h2>
          <p className={styles.sectionHint}>Traffic hitting the server</p>
        </header>
        <div className={styles.grid}>
          <ChartPanel
            title={`Inbound requests, ${suffix}`}
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.inbound_volume.length ?? 0) === 0}
            emptyText="No requests in this window."
          >
            <InboundVolumeChart
              points={visible?.inbound_volume ?? []}
              window={window}
            />
          </ChartPanel>

          <ChartPanel
            title={`Latency by route, ${suffix}`}
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.route_latency.length ?? 0) === 0}
            emptyText="No requests in this window."
          >
            <LatencyByRouteChart points={visible?.route_latency ?? []} />
          </ChartPanel>
        </div>
      </section>

      <section
        className={styles.section}
        aria-labelledby="ops-section-outbound"
      >
        <header className={styles.sectionHeader}>
          <h2 id="ops-section-outbound" className={styles.sectionTitle}>
            Outbound
          </h2>
          <p className={styles.sectionHint}>Calls we make to third parties</p>
        </header>
        <div className={styles.grid}>
          <ChartPanel
            title={`Outbound calls by service, ${suffix}`}
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.outbound_volume.length ?? 0) === 0}
            emptyText="No outbound calls in this window."
          >
            <OutboundByServiceChart
              points={visible?.outbound_volume ?? []}
              window={window}
            />
          </ChartPanel>

          <ChartPanel
            title={`Latency by service, ${suffix}`}
            subtitle="p50 / p95 / p99 over duration_ms · top 10 services"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.outbound_latency_by_service?.length ?? 0) === 0}
            emptyText="No outbound calls in this window."
          >
            <OutboundLatencyTable
              rows={visible?.outbound_latency_by_service ?? []}
            />
          </ChartPanel>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="ops-section-errors">
        <header className={styles.sectionHeader}>
          <h2 id="ops-section-errors" className={styles.sectionTitle}>
            Errors
          </h2>
          <p className={styles.sectionHint}>Non-2xx responses</p>
        </header>
        <div className={styles.grid}>
          <ChartPanel
            title={`Error rate, ${suffix}`}
            subtitle="% non-2xx · top 10 routes / top 5 services"
            isLoading={showInitialSkeleton}
            isEmpty={
              (visible?.error_rate_by_route.length ?? 0) === 0 &&
              (visible?.error_rate_by_service.length ?? 0) === 0
            }
            emptyText="No errors in this window."
          >
            <ErrorRateChart
              routes={visible?.error_rate_by_route ?? []}
              services={visible?.error_rate_by_service ?? []}
            />
          </ChartPanel>
        </div>
      </section>

      <section
        className={styles.section}
        aria-labelledby="ops-section-unsupported-blocks"
      >
        <header className={styles.sectionHeader}>
          <h2
            id="ops-section-unsupported-blocks"
            className={styles.sectionTitle}
          >
            Unsupported Notion blocks
          </h2>
          <p className={styles.sectionHint}>
            Block types dropped during conversion, all time
          </p>
        </header>
        <div className={styles.grid}>
          <ChartPanel
            title="Dropped block types"
            subtitle="Sorted by occurrences · all time"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.unsupported_blocks?.length ?? 0) === 0}
            emptyText="No unsupported blocks seen"
            autoHeight
          >
            <UnsupportedBlocksTable rows={visible?.unsupported_blocks ?? []} />
          </ChartPanel>
        </div>
      </section>

      <section
        className={styles.section}
        aria-labelledby="ops-section-conversion-output"
      >
        <header className={styles.sectionHeader}>
          <h2
            id="ops-section-conversion-output"
            className={styles.sectionTitle}
          >
            Conversion output
          </h2>
          <p className={styles.sectionHint}>
            Cards produced vs. empty backs, by source
          </p>
        </header>
        <div className={styles.grid}>
          <ChartPanel
            title="Empty backs by source"
            subtitle="Empty backs are silently dropped · all time"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.conversion_output?.length ?? 0) === 0}
            emptyText="No conversions recorded yet"
            autoHeight
          >
            <ConversionOutputTable rows={visible?.conversion_output ?? []} />
          </ChartPanel>
        </div>
      </section>

      <section
        className={styles.section}
        aria-labelledby="ops-section-parse-path"
      >
        <header className={styles.sectionHeader}>
          <h2 id="ops-section-parse-path" className={styles.sectionTitle}>
            Parse-path signatures
          </h2>
          <p className={styles.sectionHint}>
            How each conversion was recognized — watch for unclassified
          </p>
        </header>
        <div className={styles.grid}>
          <ChartPanel
            title="Parse paths"
            subtitle="Sorted by occurrences · all time"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.parse_path_signatures?.length ?? 0) === 0}
            emptyText="No conversions recorded yet"
            autoHeight
          >
            <ParsePathSignaturesTable
              rows={visible?.parse_path_signatures ?? []}
            />
          </ChartPanel>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="ops-section-storage">
        <header className={styles.sectionHeader}>
          <h2 id="ops-section-storage" className={styles.sectionTitle}>
            Storage
          </h2>
          <p className={styles.sectionHint}>
            Mind map images on S3 · fetched once per visit
          </p>
        </header>
        <div className={styles.grid}>
          <MetricCard
            title="Mindmap storage"
            value={storageValue}
            footnote={storageFootnote}
          />
        </div>
      </section>
    </>
  );
}
