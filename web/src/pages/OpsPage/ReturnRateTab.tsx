import { useMemo } from 'react';

import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import ChartPanel from './charts/ChartPanel';
import MetricCard from './MetricCard';
import { buildClaudePrompt } from './buildClaudePrompt';
import CopyForClaudeButton from './CopyForClaudeButton';
import { formatCount, formatPercent } from './opsHelpers';
import { useReturnRateMetrics } from './useReturnRateMetrics';
import { ReturnRateBySourceType } from './returnRateTypes';

const formatPct = (value: number | null): string =>
  value == null ? '—' : formatPercent(value);

const renderBySourceType = (rows: ReturnRateBySourceType[]) => {
  if (rows.length === 0) {
    return (
      <p className={styles.emptyHint}>
        No cohorts with a prior successful conversion in the last 90 days.
      </p>
    );
  }
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Source</th>
            <th>Cohort</th>
            <th>7d</th>
            <th>14d</th>
            <th>30d</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.source_type}>
              <td>{row.source_type}</td>
              <td className={styles.numeric}>{formatCount(row.cohort_size)}</td>
              <td className={styles.numeric}>
                {formatPct(row.return_rate_7d_pct)}
              </td>
              <td className={styles.numeric}>
                {formatPct(row.return_rate_14d_pct)}
              </td>
              <td className={styles.numeric}>
                {formatPct(row.return_rate_30d_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default function ReturnRateTab() {
  const { data, error, isLoading, isFetching, refetch } =
    useReturnRateMetrics();
  const isInitial = isLoading && data == null;
  const refreshing = isFetching && !isLoading;
  const generated = useMemo(() => {
    if (data?.as_of == null) return '—';
    return new Date(data.as_of).toLocaleTimeString();
  }, [data?.as_of]);

  return (
    <>
      <div className={styles.tabHeader}>
        <div className={styles.controls}>
          <button
            type="button"
            className={`${sharedStyles.btnSmall} ${styles.refreshButton}`}
            onClick={() => refetch()}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <CopyForClaudeButton
            getText={() =>
              data == null ? '' : buildClaudePrompt('return-rate', data)
            }
            disabled={data == null}
          />
        </div>
      </div>

      <p className={styles.subtitle}>
        <span>Updated {generated}</span>
        <span className={styles.subtitleSeparator}>·</span>
        <span>second conversion within N days · 90-day cohort window</span>
      </p>

      {error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          /api/ops/return-rate/metrics failed: {error.message}. Last good data
          shown below.
        </div>
      )}

      {data?.error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          Return-rate query failed on the server: {data.error}
        </div>
      )}

      <div className={styles.grid}>
        <MetricCard
          title="Returned within 7 days"
          value={formatPct(data?.overall['7d'] ?? null)}
          footnote="Share of users who converted again within a week"
        />
        <MetricCard
          title="Returned within 14 days"
          value={formatPct(data?.overall['14d'] ?? null)}
        />
        <MetricCard
          title="Returned within 30 days"
          value={formatPct(data?.overall['30d'] ?? null)}
        />

        <ChartPanel
          title="Return rate by source type"
          subtitle="Bucketed by the source of the prior successful conversion"
          isLoading={isInitial}
          isEmpty={(data?.by_source_type?.length ?? 0) === 0}
          emptyText="No cohorts in this window."
          autoHeight
        >
          {data != null && renderBySourceType(data.by_source_type ?? [])}
        </ChartPanel>
      </div>
    </>
  );
}
