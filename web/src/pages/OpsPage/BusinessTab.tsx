import { useEffect, useMemo, useState } from 'react';

import sharedStyles from '../../styles/shared.module.css';
import {
  formatCacheAge,
  formatClockShort,
  formatInteger,
  formatPercentOneDecimal,
  formatUsd,
} from './businessHelpers';
import { BusinessMetricsResponse } from './businessTypes';
import { buildClaudePrompt } from './buildClaudePrompt';
import CopyForClaudeButton from './CopyForClaudeButton';
import MetricCard, { formatNumberOrDash } from './MetricCard';
import ActiveSubsTimeseriesChart from './charts/ActiveSubsTimeseriesChart';
import CancelFunnelChart from './charts/CancelFunnelChart';
import CancellationCommentsList from './charts/CancellationCommentsList';
import CancellationReasonsChart from './charts/CancellationReasonsChart';
import ChartPanel from './charts/ChartPanel';
import EmojiFeedbackChart from './charts/EmojiFeedbackChart';
import EmojiFeedbackCommentsList from './charts/EmojiFeedbackCommentsList';
import ConversionsChurnChart from './charts/ConversionsChurnChart';
import FailedPaymentsWeeklyChart from './charts/FailedPaymentsWeeklyChart';
import MrrTimeseriesChart from './charts/MrrTimeseriesChart';
import ReEngagementCommentsList from './charts/ReEngagementCommentsList';
import ReEngagementReasonsChart from './charts/ReEngagementReasonsChart';
import SignupCountriesChart from './charts/SignupCountriesChart';
import CollapsibleSection from './CollapsibleSection';
import PaidValueMonitorTab from './PaidValueMonitorTab';
import PassUnlockMonitorTab from './PassUnlockMonitorTab';
import { useSectionSummaries } from './useSectionSummary';
import styles from './OpsPage.module.css';
import { useBusinessMetrics } from './useBusinessMetrics';
import { useCancelFunnel } from './useCancelFunnel';

const buildMrrFootnote = (
  asOf: string | null,
  cacheAgeSeconds: number | null
): string | undefined => {
  if (asOf == null) return undefined;
  const date = new Date(asOf);
  if (Number.isNaN(date.getTime())) return undefined;
  const clock = formatClockShort(date);
  if (cacheAgeSeconds == null) return `as of ${clock}`;
  return `as of ${clock} (cache ${formatCacheAge(cacheAgeSeconds)})`;
};

export default function BusinessTab() {
  const summaryFor = useSectionSummaries();
  const { data, error, isLoading, isFetching } = useBusinessMetrics();
  const { data: cancelFunnel, isLoading: cancelFunnelLoading } =
    useCancelFunnel();
  const [lastSnapshot, setLastSnapshot] =
    useState<BusinessMetricsResponse | null>(null);

  useEffect(() => {
    if (data != null) {
      setLastSnapshot(data);
    }
  }, [data]);

  const visible = data ?? lastSnapshot;
  const showInitialSkeleton = isLoading && visible == null;

  const mrrFootnote = useMemo(
    () =>
      buildMrrFootnote(
        visible?.as_of ?? null,
        visible?.cache_age_seconds ?? null
      ),
    [visible?.as_of, visible?.cache_age_seconds]
  );

  return (
    <>
      <div className={styles.tabHeader}>
        <CopyForClaudeButton
          getText={() =>
            visible == null ? '' : buildClaudePrompt('business', visible)
          }
          disabled={visible == null}
        />
      </div>

      {error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          /api/ops/business/metrics failed: {error.message}. Last good data
          shown below.
        </div>
      )}

      {isFetching && !isLoading && visible != null && error == null && (
        <p className={styles.refreshHint}>
          Last updated{' '}
          {visible.cache_age_seconds == null
            ? 'just now'
            : `${formatCacheAge(visible.cache_age_seconds)} ago`}
          {' — refreshing'}
        </p>
      )}

      <div className={styles.cardGrid}>
        <MetricCard
          title="MRR"
          value={formatNumberOrDash(visible?.mrr_usd ?? null, formatUsd)}
          footnote={mrrFootnote}
        />
        <MetricCard
          title="Net new MRR (MTD)"
          value={formatNumberOrDash(
            visible?.net_new_mrr_mtd_usd ?? null,
            formatUsd
          )}
        />
        <MetricCard
          title="Active paying subs"
          value={formatNumberOrDash(
            visible?.active_paying_subs ?? null,
            formatInteger
          )}
        />
        <MetricCard
          title="Churn (30d)"
          value={formatNumberOrDash(
            visible?.churn_30d_pct ?? null,
            formatPercentOneDecimal
          )}
        />
        <MetricCard
          title="Failed payments (7d)"
          value={formatNumberOrDash(
            visible?.failed_payments_7d ?? null,
            formatInteger
          )}
        />
        <MetricCard
          title="New paid conversions (7d)"
          value={formatNumberOrDash(
            visible?.new_paid_conversions_7d ?? null,
            formatInteger
          )}
        />
      </div>

      <CollapsibleSection slug="emoji-feedback" title="Emoji feedback">
        <p className={styles.sectionHint}>
          Ratings and comments from the in-app emoji widget
        </p>
        <div className={styles.grid}>
          <ChartPanel
            title="Emoji feedback, last 30 days"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.emoji_feedback_ratings?.length ?? 0) === 0}
            emptyText="No emoji feedback yet."
          >
            <EmojiFeedbackChart
              points={visible?.emoji_feedback_ratings ?? []}
            />
          </ChartPanel>

          <ChartPanel
            title="Recent feedback comments"
            subtitle="Latest text feedback from the emoji widget"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.emoji_feedback_comments?.length ?? 0) === 0}
            emptyText="No feedback comments yet."
          >
            <EmojiFeedbackCommentsList
              points={visible?.emoji_feedback_comments ?? []}
            />
          </ChartPanel>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        slug="revenue"
        title="Revenue & subscriptions"
        summary={summaryFor('new_paid_7d')}
      >
        <p className={styles.sectionHint}>
          MRR, active subs, churn, failed payments
        </p>
        <div className={styles.grid}>
          <ChartPanel
            title="MRR, last 90 days"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.mrr_timeseries?.length ?? 0) === 0}
            emptyText="No MRR history yet."
          >
            <MrrTimeseriesChart points={visible?.mrr_timeseries ?? []} />
          </ChartPanel>

          <ChartPanel
            title="Active paying subs, last 90 days"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.active_subs_timeseries?.length ?? 0) === 0}
            emptyText="No active-subs history yet."
          >
            <ActiveSubsTimeseriesChart
              points={visible?.active_subs_timeseries ?? []}
            />
          </ChartPanel>

          <ChartPanel
            title="New vs churned, last 12 weeks"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.conversions_vs_churn_weekly?.length ?? 0) === 0}
            emptyText="No subscription movements yet."
          >
            <ConversionsChurnChart
              points={visible?.conversions_vs_churn_weekly ?? []}
            />
          </ChartPanel>

          <ChartPanel
            title="Failed payments, last 12 weeks"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.failed_payments_weekly?.length ?? 0) === 0}
            emptyText="No failed payments in this window."
          >
            <FailedPaymentsWeeklyChart
              points={visible?.failed_payments_weekly ?? []}
            />
          </ChartPanel>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        slug="cancellations"
        title="Why users cancel"
        summary={summaryFor('churn_30d_pct')}
      >
        <p className={styles.sectionHint}>Cancel-survey reasons and comments</p>
        <div className={styles.grid}>
          <ChartPanel
            title="Cancel-flow funnel, last 30 days"
            subtitle="How many cancels the pause offer saves"
            isLoading={cancelFunnelLoading && cancelFunnel == null}
            isEmpty={
              cancelFunnel?.stages == null ||
              cancelFunnel.stages.cancel_started === 0
            }
            emptyText="No cancel-flow activity in this window."
            autoHeight
          >
            <CancelFunnelChart data={cancelFunnel ?? null} />
          </ChartPanel>

          <ChartPanel
            title="Why users cancel, last 90 days"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.cancellation_reasons_top?.length ?? 0) === 0}
            emptyText="No cancellations recorded yet."
          >
            <CancellationReasonsChart
              points={visible?.cancellation_reasons_top ?? []}
            />
          </ChartPanel>

          <ChartPanel
            title="Recent cancellation comments"
            subtitle="Latest free-text feedback from the cancel survey"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.cancellation_comments_recent?.length ?? 0) === 0}
            emptyText="No free-text comments yet."
          >
            <CancellationCommentsList
              points={visible?.cancellation_comments_recent ?? []}
            />
          </ChartPanel>
        </div>
      </CollapsibleSection>

      <CollapsibleSection slug="reengagement" title="Re-engagement feedback">
        <p className={styles.sectionHint}>
          Why people stop engaging after a re-engagement email
        </p>
        <div className={styles.grid}>
          <ChartPanel
            title="Why people stop, last 90 days"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.reengagement_reasons_top?.length ?? 0) === 0}
            emptyText="No re-engagement feedback recorded yet."
          >
            <ReEngagementReasonsChart
              points={visible?.reengagement_reasons_top ?? []}
            />
          </ChartPanel>

          <ChartPanel
            title="Recent re-engagement comments"
            subtitle="Latest free-text feedback after a re-engagement email"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.reengagement_comments_recent?.length ?? 0) === 0}
            emptyText="No re-engagement comments yet."
          >
            <ReEngagementCommentsList
              points={visible?.reengagement_comments_recent ?? []}
            />
          </ChartPanel>
        </div>
      </CollapsibleSection>

      <CollapsibleSection slug="geography" title="Geography">
        <p className={styles.sectionHint}>Where new signups come from</p>
        <div className={styles.grid}>
          <ChartPanel
            title="Signups by country, last 90 days"
            subtitle="Top 10 by signup count · ISO country codes"
            isLoading={showInitialSkeleton}
            isEmpty={(visible?.signup_countries_90d?.length ?? 0) === 0}
            emptyText="No countries captured yet."
          >
            <SignupCountriesChart
              points={visible?.signup_countries_90d ?? []}
            />
          </ChartPanel>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        slug="pass-unlocks"
        title="Pass unlocks"
        summary={summaryFor('missing_pass_unlocks_7d')}
      >
        <PassUnlockMonitorTab />
      </CollapsibleSection>

      <CollapsibleSection
        slug="paid-value"
        title="Paid value"
        summary={summaryFor('zero_value_paid_7d')}
      >
        <PaidValueMonitorTab />
      </CollapsibleSection>
    </>
  );
}
