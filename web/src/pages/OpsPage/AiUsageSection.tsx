import { useState } from 'react';

import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import { AI_USAGE_WINDOWS, AiUsageGroup, AiUsageWindow } from './aiUsageTypes';
import { formatCount } from './opsHelpers';
import { useAiUsage } from './useAiUsage';
import MetricCard from './MetricCard';
import ChartPanel from './charts/ChartPanel';

const WINDOW_LABEL: Record<AiUsageWindow, string> = {
  '7d': 'Last 7 days',
  '14d': 'Last 14 days',
  '30d': 'Last 30 days',
  '60d': 'Last 60 days',
  '90d': 'Last 90 days',
};

const formatUsd = (value: number): string =>
  `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

interface GroupTableProps {
  label: string;
  rows: AiUsageGroup[];
}

function GroupTable({ label, rows }: Readonly<GroupTableProps>) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{label}</th>
          <th>Calls</th>
          <th>Input tokens</th>
          <th>Output tokens</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td>{row.key}</td>
            <td className={styles.numeric}>{formatCount(row.calls)}</td>
            <td className={styles.numeric}>{formatCount(row.input_tokens)}</td>
            <td className={styles.numeric}>{formatCount(row.output_tokens)}</td>
            <td className={styles.numeric}>{formatUsd(row.cost_usd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AiUsageSection() {
  const [window, setWindow] = useState<AiUsageWindow>('30d');
  const { data, error, isLoading } = useAiUsage(window);

  const totals = data?.totals;
  const cacheFootnote =
    totals == null
      ? undefined
      : `${formatCount(totals.cache_read_tokens)} cache reads · ${formatCount(totals.cache_creation_tokens)} cache writes`;

  return (
    <>
      <div className={styles.tabHeader}>
        <div className={styles.controls}>
          <label className={styles.controlsLabel} htmlFor="ai-usage-window">
            Window
          </label>
          <select
            id="ai-usage-window"
            className={`${sharedStyles.select} ${styles.windowSelect}`}
            value={window}
            onChange={(event) => setWindow(event.target.value as AiUsageWindow)}
          >
            {AI_USAGE_WINDOWS.map((value) => (
              <option key={value} value={value}>
                {WINDOW_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          /api/ops/ai-usage failed: {error.message}
        </div>
      )}

      <div className={styles.grid}>
        <MetricCard
          title="AI spend"
          value={totals == null ? '—' : formatUsd(totals.cost_usd)}
          footnote={
            totals == null ? undefined : `${formatCount(totals.calls)} calls`
          }
        />
        <MetricCard
          title="Tokens"
          value={
            totals == null
              ? '—'
              : `${formatCount(totals.input_tokens)} in · ${formatCount(totals.output_tokens)} out`
          }
          footnote={cacheFootnote}
        />
      </div>

      <div className={styles.grid}>
        <ChartPanel
          title="Spend by surface"
          subtitle="Which product feature costs what"
          isLoading={isLoading}
          isEmpty={(data?.by_surface.length ?? 0) === 0}
          emptyText="No AI calls recorded in this window."
          autoHeight
        >
          <GroupTable label="Surface" rows={data?.by_surface ?? []} />
        </ChartPanel>

        <ChartPanel
          title="Spend by model"
          subtitle="Cost per Claude model"
          isLoading={isLoading}
          isEmpty={(data?.by_model.length ?? 0) === 0}
          emptyText="No AI calls recorded in this window."
          autoHeight
        >
          <GroupTable label="Model" rows={data?.by_model ?? []} />
        </ChartPanel>

        <ChartPanel
          title="Spend by day"
          subtitle="Daily cost trend"
          isLoading={isLoading}
          isEmpty={(data?.by_day.length ?? 0) === 0}
          emptyText="No AI calls recorded in this window."
          autoHeight
        >
          <GroupTable label="Day" rows={data?.by_day ?? []} />
        </ChartPanel>
      </div>
    </>
  );
}
