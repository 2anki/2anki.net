import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import { OPS_WINDOWS, OpsWindow } from './opsWindow';
import { formatAge, useOpsFreshness } from './useOpsFreshness';

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
      <span>updated {formatAge(ageMs)}</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        className={sharedStyles.btnSmall}
        onClick={refresh}
        disabled={fetching}
      >
        {fetching ? 'Refreshing…' : 'Refresh'}
      </button>
    </p>
  );
}
