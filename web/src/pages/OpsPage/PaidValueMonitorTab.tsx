import { useState } from 'react';

import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import MetricCard from './MetricCard';
import {
  getPaidValueMonitor,
  PaidValueMonitorResponse,
  PassValueGroup,
  PassValueRow,
  SubscriptionValueGroup,
  SubscriptionValueRow,
  PaidValueWindow,
  PAID_VALUE_WINDOWS,
} from './paidValueMonitor';

type Status = 'idle' | 'loading' | 'success' | 'error';

function summarize(data: PaidValueMonitorResponse): string {
  const groups = [
    data.passes,
    data.claimedAnonymousPasses,
    data.newSubscriptions,
  ];
  const checked = groups.reduce((sum, group) => sum + group.checked, 0);
  const tried = groups.reduce((sum, group) => sum + group.zeroValueTried, 0);
  const never = groups.reduce(
    (sum, group) => sum + group.zeroValueNeverTried,
    0
  );
  return `${checked} paid unit${checked === 1 ? '' : 's'} checked — ${tried} tried and failed, ${never} never tried, ${data.unclaimedAnonymousPasses} unclaimed anonymous pass${data.unclaimedAnonymousPasses === 1 ? '' : 'es'} (unlinkable).`;
}

function summaryCards(group: PassValueGroup | SubscriptionValueGroup) {
  return (
    <div className={styles.cardGrid}>
      <MetricCard title="Checked" value={String(group.checked)} />
      <MetricCard title="With value" value={String(group.withValue)} />
      <MetricCard
        title="Zero-value tried"
        value={String(group.zeroValueTried)}
      />
      <MetricCard
        title="Never tried"
        value={String(group.zeroValueNeverTried)}
      />
    </div>
  );
}

function resultLabel(row: PassValueRow | SubscriptionValueRow): string {
  return row.classification === 'tried' ? 'Tried, failed' : 'Never tried';
}

function passRowsTable(rows: PassValueRow[]) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>User</th>
            <th>Kind</th>
            <th>Expires</th>
            <th>Successes</th>
            <th>Failures</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.userId}-${row.expiresAt}`}>
              <td>{row.userId}</td>
              <td>{row.kind}</td>
              <td>{new Date(row.expiresAt).toLocaleString()}</td>
              <td>{row.successes}</td>
              <td>{row.failures}</td>
              <td>{resultLabel(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function subscriptionRowsTable(rows: SubscriptionValueRow[]) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>User</th>
            <th>Subscribed</th>
            <th>Successes</th>
            <th>Failures</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.userId}-${row.subscribedAt}`}>
              <td>{row.userId}</td>
              <td>{new Date(row.subscribedAt).toLocaleString()}</td>
              <td>{row.successes}</td>
              <td>{row.failures}</td>
              <td>{resultLabel(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderResults(data: PaidValueMonitorResponse) {
  return (
    <>
      <h3 className={styles.sectionTitle}>Day/Week passes</h3>
      {summaryCards(data.passes)}
      {passRowsTable(data.passes.rows)}

      <h3 className={styles.sectionTitle}>Claimed anonymous passes</h3>
      {summaryCards(data.claimedAnonymousPasses)}
      {passRowsTable(data.claimedAnonymousPasses.rows)}

      <h3 className={styles.sectionTitle}>New subscriptions</h3>
      {summaryCards(data.newSubscriptions)}
      {subscriptionRowsTable(data.newSubscriptions.rows)}
    </>
  );
}

export default function PaidValueMonitorTab() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [window, setWindow] = useState<PaidValueWindow>('7d');
  const [data, setData] = useState<PaidValueMonitorResponse | null>(null);

  const run = async () => {
    setStatus('loading');
    setMessage('');
    try {
      const result = await getPaidValueMonitor(window);
      setData(result);
      const tried =
        result.passes.zeroValueTried +
        result.claimedAnonymousPasses.zeroValueTried +
        result.newSubscriptions.zeroValueTried;
      setStatus(tried > 0 ? 'error' : 'success');
      setMessage(summarize(result));
    } catch (error) {
      setData(null);
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  return (
    <section className={`${sharedStyles.surface} ${styles.card}`}>
      <h2 className={styles.cardTitle}>Paid value monitor</h2>
      <p className={styles.panelSubtitle}>
        Finds paying users who produced zero successful conversions in their
        paid window. Zero-value tried (a failure but no success or download) is
        the urgent case — a buyer who hit a bug. Never tried is a buyer who
        never uploaded. Unclaimed anonymous passes cannot be linked to a user,
        so they are reported as a count only, never guessed.
      </p>
      <div className={styles.controls}>
        <label htmlFor="paid-value-window" className={styles.controlsLabel}>
          Window
        </label>
        <select
          id="paid-value-window"
          className={`${sharedStyles.select} ${styles.windowSelect}`}
          value={window}
          onChange={(e) => setWindow(e.target.value as PaidValueWindow)}
        >
          {PAID_VALUE_WINDOWS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={sharedStyles.btnSmall}
          onClick={run}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Checking…' : 'Check value'}
        </button>
      </div>

      {status === 'success' && message && (
        <div className={`${sharedStyles.alertSuccess} ${styles.banner}`}>
          {message}
        </div>
      )}
      {status === 'error' && message && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {message}
        </div>
      )}

      {data != null && renderResults(data)}
    </section>
  );
}
