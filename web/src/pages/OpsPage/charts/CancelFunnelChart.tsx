import { CancelFunnelResponse } from '../cancelFunnelTypes';
import styles from '../OpsPage.module.css';

interface CancelFunnelChartProps {
  data: CancelFunnelResponse | null;
}

const STAGE_LABELS: ReadonlyArray<{
  key: keyof NonNullable<CancelFunnelResponse['stages']>;
  label: string;
}> = [
  { key: 'cancel_started', label: 'cancel started' },
  { key: 'cancelled', label: 'cancelled' },
];

export default function CancelFunnelChart({
  data,
}: Readonly<CancelFunnelChartProps>) {
  if (data == null || data.stages == null) {
    return (
      <div className={styles.chartEmpty}>No cancellations recorded yet.</div>
    );
  }

  const { stages } = data;

  return (
    <ul className={styles.cancelStageList}>
      {STAGE_LABELS.map(({ key, label }) => (
        <li key={key} className={styles.cancelStageRow}>
          <span className={styles.cancelStageLabel}>{label}</span>
          <span className={styles.cancelStageValue}>{stages[key]}</span>
        </li>
      ))}
    </ul>
  );
}
