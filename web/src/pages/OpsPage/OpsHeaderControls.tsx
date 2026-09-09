import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import { OPS_WINDOWS, OpsWindow } from './opsWindow';
import { formatAge, useOpsFreshness } from './useOpsFreshness';

const WINDOW_DAYS: Record<OpsWindow, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

interface OpsWindowControlProps {
  window: OpsWindow;
  onChange: (next: OpsWindow) => void;
}

export function OpsWindowControl({
  window,
  onChange,
}: Readonly<OpsWindowControlProps>) {
  return (
    <div role="group" aria-label="Window" className={styles.segmented}>
      {OPS_WINDOWS.map((value) => (
        <button
          key={value}
          type="button"
          className={styles.segment}
          aria-pressed={value === window}
          aria-label={`Last ${WINDOW_DAYS[value]} days`}
          onClick={() => onChange(value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

export function OpsFreshness() {
  const { ageMs, fetching, refresh } = useOpsFreshness();
  return (
    <p className={styles.freshness}>
      <span>Updated {formatAge(ageMs)}</span>
      <span aria-hidden="true">·</span>
      <button type="button" className={sharedStyles.btnSmall} onClick={refresh}>
        {fetching ? 'Refreshing…' : 'Refresh'}
      </button>
    </p>
  );
}
