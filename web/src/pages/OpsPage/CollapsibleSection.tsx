import { ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import {
  describeDelta,
  formatScoreDelta,
  formatScoreTarget,
  formatScoreValue,
} from './todayScore';
import { ScoreRow } from './todayTypes';

interface SectionState {
  open: boolean;
  mounted: boolean;
  openedForHash: string | null;
}

interface CollapsibleSectionProps {
  slug: string;
  title: string;
  summary?: ScoreRow | null;
  children: ReactNode;
}

export default function CollapsibleSection({
  slug,
  title,
  summary,
  children,
}: Readonly<CollapsibleSectionProps>) {
  const { hash } = useLocation();
  const targeted = hash === `#${slug}`;
  const [state, setState] = useState<SectionState>({
    open: targeted,
    mounted: targeted,
    openedForHash: targeted ? hash : null,
  });
  const element = useRef<HTMLDetailsElement>(null);

  if (targeted && state.openedForHash !== hash) {
    setState({ open: true, mounted: true, openedForHash: hash });
  }

  useEffect(() => {
    if (targeted) {
      element.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [targeted]);

  const { open, mounted } = state;

  const status = summary?.status ?? 'none';

  return (
    <details
      id={slug}
      ref={element}
      className={styles.collapsible}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setState((current) => ({
          ...current,
          open: next,
          mounted: current.mounted || next,
        }));
      }}
    >
      <summary className={styles.sectionSummary} data-status={status}>
        <span className={styles.scoreBar} aria-hidden="true" />
        <h2 className={styles.sectionSummaryTitle}>
          {title}
          {summary != null && status !== 'none' && (
            <span className={sharedStyles.srOnly}>, status {status}</span>
          )}
        </h2>
        {summary == null ? (
          <span className={styles.sectionSummaryMetric} />
        ) : (
          <>
            <span className={styles.sectionSummaryMetric}>
              {summary.label}
              <span aria-hidden="true"> · </span>
              <span className={sharedStyles.srOnly}>, </span>
              {summary.window_label}
            </span>
            <span className={styles.scoreValue}>
              {formatScoreValue(summary)}
            </span>
            <span
              className={styles.scoreDelta}
              data-good={
                summary.delta_good == null
                  ? undefined
                  : String(summary.delta_good)
              }
              aria-label={describeDelta(summary)}
            >
              {formatScoreDelta(summary)}
            </span>
            <span className={styles.scoreTarget}>
              {formatScoreTarget(summary)}
            </span>
          </>
        )}
      </summary>
      {mounted && <div className={styles.collapsibleBody}>{children}</div>}
    </details>
  );
}
