import { useCallback, useEffect, useMemo, useState } from 'react';

import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import { usePerformanceMetrics } from './usePerformanceMetrics';
import ChartPanel from './charts/ChartPanel';
import { formatCount } from './opsHelpers';
import {
  JobDurationPercentiles,
  PerformanceMetricsResponse,
  SignupCountryBreakdownItem,
} from './performanceTypes';

interface JobIdCellProps {
  id: number;
}

function JobIdCell({ id }: Readonly<JobIdCellProps>) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleClick = useCallback(() => {
    const text = String(id);
    if (navigator.clipboard?.writeText != null) {
      navigator.clipboard
        .writeText(text)
        .then(() => setCopied(true))
        .catch(() => setCopied(false));
    }
  }, [id]);

  return (
    <button
      type="button"
      className={`${styles.jobIdButton} ${copied ? styles.jobIdCopied : ''}`}
      onClick={handleClick}
      aria-label={`Copy job ID ${id} to clipboard`}
      title={copied ? 'Copied' : 'Click to copy'}
    >
      #{id}
      {copied ? ' ✓' : ''}
    </button>
  );
}

const formatMs = (value: number | null): string => {
  if (value == null) return '—';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)} s`;
};

const STATUS_COLORS: Record<string, string> = {
  done: '#10b981',
  failed: '#dc2626',
  cancelled: '#9ca3af',
  interrupted: '#f59e0b',
};

const COUNTRY_BAR_COLOR = '#3b82f6';

const renderDurationsTable = (rows: JobDurationPercentiles[]) => (
  <div className={styles.tableScroll}>
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Window</th>
          <th>p50</th>
          <th>p95</th>
          <th>p99</th>
          <th>Completed jobs</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.window}>
            <td>{row.window === '24h' ? 'Last 24h' : 'Last 7d'}</td>
            <td className={styles.numeric}>{formatMs(row.p50_ms)}</td>
            <td className={styles.numeric}>{formatMs(row.p95_ms)}</td>
            <td className={styles.numeric}>{formatMs(row.p99_ms)}</td>
            <td className={styles.numeric}>{formatCount(row.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const renderStatusBreakdown = (
  rows: PerformanceMetricsResponse['status_breakdown_24h']
) => {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total === 0) {
    return (
      <p className={styles.emptyHint}>
        No terminal-status jobs in the last 24h.
      </p>
    );
  }
  return (
    <ul className={styles.statusList} aria-label="Job status breakdown">
      {rows.map((row) => {
        const pct = total === 0 ? 0 : (row.count / total) * 100;
        const color = STATUS_COLORS[row.status] ?? '#6b7280';
        return (
          <li key={row.status} className={styles.statusRow}>
            <span className={styles.statusLabel}>
              <span
                aria-hidden="true"
                className={styles.statusDot}
                style={{ backgroundColor: color }}
              />
              {row.status}
            </span>
            <span className={styles.statusBarWrap}>
              <span
                className={styles.statusBar}
                style={{
                  width: `${pct}%`,
                  backgroundColor: color,
                }}
              />
            </span>
            <span className={styles.numeric}>{formatCount(row.count)}</span>
            <span className={styles.numericMuted}>{pct.toFixed(1)}%</span>
          </li>
        );
      })}
    </ul>
  );
};

const renderSlowestJobs = (
  rows: PerformanceMetricsResponse['slowest_jobs_24h']
) => {
  if (rows.length === 0) {
    return (
      <p className={styles.emptyHint}>No completed jobs in the last 24h.</p>
    );
  }
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Job</th>
            <th>Type</th>
            <th>Duration</th>
            <th>Cards</th>
            <th>Completed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className={styles.numericMuted}>
                <JobIdCell id={row.id} />
              </td>
              <td>{row.type ?? '—'}</td>
              <td className={styles.numeric}>{formatMs(row.duration_ms)}</td>
              <td className={styles.numeric}>
                {row.card_count == null ? '—' : formatCount(row.card_count)}
              </td>
              <td className={styles.numericMuted}>
                {new Date(row.completed_at).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const renderCountries = (
  rows: SignupCountryBreakdownItem[],
  othersCount: number
) => {
  if (rows.length === 0) {
    return (
      <p className={styles.emptyHint}>
        No countries captured yet. New signups populate this within minutes.
      </p>
    );
  }
  const max = Math.max(...rows.map((row) => row.count));
  return (
    <ul className={styles.statusList} aria-label="Signup country breakdown">
      {rows.map((row) => {
        const pct = max === 0 ? 0 : (row.count / max) * 100;
        return (
          <li key={row.country} className={styles.statusRow}>
            <span className={styles.statusLabel}>{row.country}</span>
            <span className={styles.statusBarWrap}>
              <span
                className={styles.statusBar}
                style={{
                  width: `${pct}%`,
                  backgroundColor: COUNTRY_BAR_COLOR,
                }}
              />
            </span>
            <span className={styles.numeric}>{formatCount(row.count)}</span>
          </li>
        );
      })}
      {othersCount > 0 && (
        <li className={styles.statusRow}>
          <span className={`${styles.statusLabel} ${styles.numericMuted}`}>
            +{othersCount} others
          </span>
          <span className={styles.statusBarWrap} />
          <span className={styles.numericMuted}>—</span>
        </li>
      )}
    </ul>
  );
};

export default function PerformanceTab() {
  const { data, error, isLoading, isFetching, refetch } =
    usePerformanceMetrics();
  const isInitial = isLoading && data == null;
  const refreshing = isFetching && !isLoading;
  const generated = useMemo(() => {
    if (data?.generated_at == null) return '—';
    return new Date(data.generated_at).toLocaleTimeString();
  }, [data?.generated_at]);

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
        </div>
      </div>

      <p className={styles.subtitle}>
        <span>Updated {generated}</span>
        <span className={styles.subtitleSeparator}>·</span>
        <span>auto-refresh every 30s</span>
      </p>

      {error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          /api/ops/performance/metrics failed: {error.message}. Last good data
          shown below.
        </div>
      )}

      <div className={styles.grid}>
        <ChartPanel
          title="Job duration percentiles"
          subtitle="From job start to terminal status, completed jobs only"
          isLoading={isInitial}
          isEmpty={(data?.durations.length ?? 0) === 0}
          emptyText="No completed jobs yet."
        >
          {data != null && renderDurationsTable(data.durations)}
        </ChartPanel>

        <ChartPanel
          title="Job outcomes, last 24h"
          subtitle="Terminal status breakdown — done / failed / cancelled / interrupted"
          isLoading={isInitial}
          isEmpty={(data?.status_breakdown_24h.length ?? 0) === 0}
          emptyText="No terminal-status jobs in this window."
        >
          {data != null && renderStatusBreakdown(data.status_breakdown_24h)}
        </ChartPanel>

        <ChartPanel
          title="Slowest 20 jobs, last 24h"
          subtitle="Click an ID to copy it for pg lookup"
          isLoading={isInitial}
          isEmpty={(data?.slowest_jobs_24h.length ?? 0) === 0}
          emptyText="No completed jobs in this window."
          autoHeight
        >
          {data != null && renderSlowestJobs(data.slowest_jobs_24h)}
        </ChartPanel>

        <ChartPanel
          title="Signup countries, last 7d"
          subtitle="ISO 3166 codes from CloudFront-Viewer-Country at signup"
          isLoading={isInitial}
          isEmpty={(data?.signup_countries_7d.length ?? 0) === 0}
          emptyText="No countries captured yet."
          autoHeight
        >
          {data != null &&
            renderCountries(
              data.signup_countries_7d,
              data.signup_countries_7d_others ?? 0
            )}
        </ChartPanel>
      </div>
    </>
  );
}
