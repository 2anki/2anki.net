import { useEffect, useState } from 'react';

import sharedStyles from '../../styles/shared.module.css';
import {
  formatDurationMinutes,
  formatInteger,
  formatPercentOneDecimal,
} from './businessHelpers';
import { ConversionMetricsResponse } from './conversionTypes';
import { buildClaudePrompt } from './buildClaudePrompt';
import CopyForClaudeButton from './CopyForClaudeButton';
import ChartPanel from './charts/ChartPanel';
import FailedConversionsWeeklyChart from './charts/FailedConversionsWeeklyChart';
import FailureReasonsChart from './charts/FailureReasonsChart';
import DeckQualitySection from './DeckQualitySection';
import MetricCard, { formatNumberOrDash } from './MetricCard';
import styles from './OpsPage.module.css';
import { useConversionMetrics } from './useConversionMetrics';

export default function ConversionsTab() {
  const { data, error, isLoading } = useConversionMetrics();
  const [lastSnapshot, setLastSnapshot] =
    useState<ConversionMetricsResponse | null>(null);

  useEffect(() => {
    if (data != null) {
      setLastSnapshot(data);
    }
  }, [data]);

  const visible = data ?? lastSnapshot;
  const showInitialSkeleton = isLoading && visible == null;

  return (
    <>
      <div className={styles.tabHeader}>
        <CopyForClaudeButton
          getText={() =>
            visible == null ? '' : buildClaudePrompt('conversions', visible)
          }
          disabled={visible == null}
        />
      </div>

      {error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          /api/ops/conversion/metrics failed: {error.message}. Last good data
          shown below.
        </div>
      )}

      <section className={styles.section} aria-labelledby="conv-section-volume">
        <header className={styles.sectionHeader}>
          <h2 id="conv-section-volume" className={styles.sectionTitle}>
            Volume, last 7 days
          </h2>
          <p className={styles.sectionHint}>Completed conversions by tier</p>
        </header>
        <div className={styles.cardGrid}>
          <MetricCard
            title="Free conversions"
            value={formatNumberOrDash(
              visible?.free_conversions_7d ?? null,
              formatInteger
            )}
          />
          <MetricCard
            title="Paid conversions"
            value={formatNumberOrDash(
              visible?.paid_conversions_7d ?? null,
              formatInteger
            )}
          />
        </div>
      </section>

      <section
        className={styles.section}
        aria-labelledby="conv-section-success"
      >
        <header className={styles.sectionHeader}>
          <h2 id="conv-section-success" className={styles.sectionTitle}>
            Success rate, last 7 days
          </h2>
          <p className={styles.sectionHint}>
            done ÷ (done + technical failures) — plan-limit blocks excluded
          </p>
        </header>
        <div className={styles.cardGrid}>
          <MetricCard
            title="Free success rate"
            value={formatNumberOrDash(
              visible?.free_conversion_success_rate_7d ?? null,
              formatPercentOneDecimal
            )}
          />
          <MetricCard
            title="Paid success rate"
            value={formatNumberOrDash(
              visible?.paid_conversion_success_rate_7d ?? null,
              formatPercentOneDecimal
            )}
          />
          <MetricCard
            title="Free blocked by plan"
            value={formatNumberOrDash(
              visible?.free_blocked_by_plan_7d ?? null,
              formatInteger
            )}
            footnote="Monthly-limit blocks, not conversion errors"
          />
          <MetricCard
            title="Paid blocked by plan"
            value={formatNumberOrDash(
              visible?.paid_blocked_by_plan_7d ?? null,
              formatInteger
            )}
            footnote="Monthly-limit blocks, not conversion errors"
          />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="conv-section-funnel">
        <header className={styles.sectionHeader}>
          <h2 id="conv-section-funnel" className={styles.sectionTitle}>
            Funnel
          </h2>
          <p className={styles.sectionHint}>
            From signup or upload to a downloaded deck
          </p>
        </header>
        <div className={styles.cardGrid}>
          <MetricCard
            title="Time to first deck"
            value={formatNumberOrDash(
              visible?.time_to_first_deck_median_minutes_30d ?? null,
              formatDurationMinutes
            )}
            footnote="Median, accounts created in the last 30 days"
          />
          <MetricCard
            title="Upload → download rate"
            value={formatNumberOrDash(
              visible?.upload_to_download_rate_7d ?? null,
              formatPercentOneDecimal
            )}
            footnote="Distinct visitors, last 7 days"
          />
        </div>
      </section>

      <section
        className={styles.section}
        aria-labelledby="conv-section-failures"
      >
        <header className={styles.sectionHeader}>
          <h2 id="conv-section-failures" className={styles.sectionTitle}>
            Failures
          </h2>
          <p className={styles.sectionHint}>What is breaking and how often</p>
        </header>
        <div className={styles.grid}>
          <ChartPanel
            title="Top failure reasons, last 7 days"
            subtitle="From jobs.job_reason_failure · top 10"
            isLoading={showInitialSkeleton}
            isEmpty={
              (visible?.conversion_errors_7d_top_reasons?.length ?? 0) === 0
            }
            emptyText="No failed conversions in this window."
          >
            <FailureReasonsChart
              points={visible?.conversion_errors_7d_top_reasons ?? []}
            />
          </ChartPanel>

          <ChartPanel
            title="Failed conversions, last 12 weeks"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.failed_conversions_weekly?.length ?? 0) === 0}
            emptyText="No failed conversions in this window."
          >
            <FailedConversionsWeeklyChart
              points={visible?.failed_conversions_weekly ?? []}
            />
          </ChartPanel>
        </div>
      </section>

      <DeckQualitySection cohorts={visible?.deck_quality_cohorts_30d ?? null} />
    </>
  );
}
