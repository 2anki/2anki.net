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

const formatRateWithBase = (rate: number | null, eligible: number): string =>
  rate == null ? '—' : `${formatPercent(rate)} (${formatCount(eligible)})`;

const eligibleFootnote = (eligible: number): string =>
  eligible === 0
    ? 'None old enough yet'
    : `Share of ${formatCount(eligible)} new identities old enough for this window`;

const renderBySourceType = (rows: ReturnRateBySourceType[]) => {
  if (rows.length === 0) {
    return (
      <p className={styles.emptyHint}>
        No new identities with a first conversion in the last 90 days.
      </p>
    );
  }
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Source</th>
            <th>New</th>
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
                {formatRateWithBase(row.return_rate_7d_pct, row.eligible_7d)}
              </td>
              <td className={styles.numeric}>
                {formatRateWithBase(row.return_rate_14d_pct, row.eligible_14d)}
              </td>
              <td className={styles.numeric}>
                {formatRateWithBase(row.return_rate_30d_pct, row.eligible_30d)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default function ReturnRateTab() {
  const { data, error, isLoading } = useReturnRateMetrics();
  const isInitial = isLoading && data == null;

  return (
    <>
      <div className={styles.tabHeader}>
        <div className={styles.controls}>
          <CopyForClaudeButton
            getText={() =>
              data == null ? '' : buildClaudePrompt('return-rate', data)
            }
            disabled={data == null}
          />
        </div>
      </div>

      <p className={styles.subtitle}>
        A return is a conversion at least 24 hours after the first · only
        identities old enough for the whole window are counted · 90-day cohort
        window
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
          footnote={
            data == null ? undefined : eligibleFootnote(data.eligible['7d'])
          }
        />
        <MetricCard
          title="Returned within 14 days"
          value={formatPct(data?.overall['14d'] ?? null)}
          footnote={
            data == null ? undefined : eligibleFootnote(data.eligible['14d'])
          }
        />
        <MetricCard
          title="Returned within 30 days"
          value={formatPct(data?.overall['30d'] ?? null)}
          footnote={
            data == null ? undefined : eligibleFootnote(data.eligible['30d'])
          }
        />

        <ChartPanel
          title="Return rate by source type"
          subtitle="Bucketed by the source of each identity's first conversion; the count in brackets is how many were old enough for that window"
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
