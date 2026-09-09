import { Fragment } from 'react';
import { Link } from 'react-router-dom';

import sharedStyles from '../../styles/shared.module.css';
import CopyForClaudeButton from './CopyForClaudeButton';
import styles from './OpsPage.module.css';
import {
  buildScoreCopyText,
  formatScoreDelta,
  formatScoreTarget,
  formatScoreValue,
  needsAttention,
} from './todayScore';
import { ScoreRow, TodaySnapshotResponse } from './todayTypes';

function ScoreLine({ row }: Readonly<{ row: ScoreRow }>) {
  const attention = needsAttention(row);
  return (
    <li className={styles.scoreRow} data-status={row.status}>
      <span className={styles.scoreBar} aria-hidden="true" />
      <Link to={row.link} className={styles.scoreLabel}>
        {row.label}
        <span className={styles.scoreWindow}> · {row.window_label}</span>
      </Link>
      <span className={styles.scoreValue}>{formatScoreValue(row)}</span>
      <span
        className={styles.scoreDelta}
        data-good={row.delta_good == null ? undefined : String(row.delta_good)}
      >
        {formatScoreDelta(row)}
      </span>
      <span className={styles.scoreTarget}>{formatScoreTarget(row)}</span>
      <span className={styles.scoreAction}>
        {attention && (
          <CopyForClaudeButton getText={() => buildScoreCopyText(row)} />
        )}
      </span>
    </li>
  );
}

interface ScoreboardProps {
  snapshot: TodaySnapshotResponse | undefined;
  error: Error | null;
  isLoading: boolean;
}

export default function Scoreboard({
  snapshot,
  error,
  isLoading,
}: Readonly<ScoreboardProps>) {
  const rows = snapshot?.rows ?? [];
  const attentionCount = rows.filter(needsAttention).length;
  const firstCalmIndex = rows.findIndex((row) => !needsAttention(row));
  const showDivider = attentionCount > 0 && firstCalmIndex > 0;

  return (
    <section className={styles.todaySection} aria-labelledby="today-scoreboard">
      <div className={styles.scoreHeader}>
        <h2 id="today-scoreboard" className={styles.sectionTitle}>
          Scoreboard
        </h2>
        {snapshot != null && (
          <p className={styles.scoreSummary}>
            {attentionCount === 0
              ? 'Nothing needs you today.'
              : `${attentionCount} need attention`}
            {snapshot.stale ? ' · stale' : ''}
          </p>
        )}
      </div>

      {error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          /api/ops/today failed: {error.message}
        </div>
      )}

      {snapshot?.errors.map((item) => (
        <div
          key={item.source}
          className={`${sharedStyles.notificationInfo} ${styles.banner}`}
        >
          {item.source} unavailable: {item.message}
        </div>
      ))}

      {isLoading && snapshot == null && (
        <p className={styles.emptyHint}>Reading the scoreboard</p>
      )}

      {rows.length > 0 && (
        <ul className={styles.scoreList}>
          <li className={styles.scoreHeadRow} aria-hidden="true">
            <span />
            <span>Metric</span>
            <span className={styles.scoreValue}>Value</span>
            <span className={styles.scoreDelta}>Δ</span>
            <span className={styles.scoreTarget}>Target</span>
            <span />
          </li>
          {rows.map((row, index) => (
            <Fragment key={row.id}>
              {showDivider && index === firstCalmIndex && (
                <li className={styles.scoreDivider} aria-hidden="true" />
              )}
              <ScoreLine row={row} />
            </Fragment>
          ))}
        </ul>
      )}
    </section>
  );
}
