import { useMemo, useState } from 'react';
import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import { formatCount } from './opsHelpers';
import { useOpsWindow } from './opsWindow';
import { useCustomerSignals } from './useCustomerSignals';
import {
  CustomerSignalBucket,
  CustomerSignalRow,
  CustomerSignalSource,
  CustomerSignalStream,
} from './customerSignalsTypes';

const SOURCE_LABELS: Record<CustomerSignalSource, string> = {
  cancel_reason: 'Cancellation reason',
  cancel_comment: 'Cancellation comment',
  emoji_feedback: 'Deck-ready feedback',
  failed_conversion: 'Failed conversion',
  empty_back: 'Empty-back cards',
  behavioral_dropoff: 'Behavioral drop-off',
};

const BUCKET_LABELS: Record<CustomerSignalBucket, string> = {
  'pain-killer': 'Pain killer',
  'money-multiplier': 'Money multiplier',
  unknown: '—',
};

const STREAM_LABELS: Record<CustomerSignalStream, string> = {
  said: 'Said',
  behavioral: 'Behavioral',
  revenue: 'Revenue',
};

type BucketFilter = 'all' | CustomerSignalBucket;
type SortKey = 'convergence' | 'count';

const BUCKET_FILTERS: { value: BucketFilter; label: string }[] = [
  { value: 'all', label: 'All buckets' },
  { value: 'pain-killer', label: 'Pain killer' },
  { value: 'money-multiplier', label: 'Money multiplier' },
  { value: 'unknown', label: 'Unclassified' },
];

function sortSignals(
  signals: CustomerSignalRow[],
  key: SortKey
): CustomerSignalRow[] {
  const compare =
    key === 'count'
      ? (a: CustomerSignalRow, b: CustomerSignalRow) =>
          b.count - a.count || b.convergence - a.convergence
      : (a: CustomerSignalRow, b: CustomerSignalRow) =>
          b.convergence - a.convergence || b.count - a.count;
  return [...signals].sort(compare);
}

function renderRows(signals: CustomerSignalRow[]) {
  if (signals.length === 0) {
    return (
      <p className={styles.emptyHint}>No customer signal in this window yet.</p>
    );
  }
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Source</th>
            <th>Signal</th>
            <th>Count</th>
            <th>Convergence</th>
            <th>Streams</th>
            <th>Bucket</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((signal, index) => (
            <tr key={`${signal.source}-${signal.label}-${index}`}>
              <td>{SOURCE_LABELS[signal.source]}</td>
              <td>
                {signal.label}
                {signal.sampleQuote != null && (
                  <p className={styles.commentBody} data-hj-suppress>
                    {signal.sampleQuote}
                  </p>
                )}
              </td>
              <td className={styles.numeric}>{formatCount(signal.count)}</td>
              <td className={styles.numeric}>{signal.convergence}×</td>
              <td>{STREAM_LABELS[signal.stream]}</td>
              <td>{BUCKET_LABELS[signal.bucket]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CustomerSignalsTab() {
  const window = useOpsWindow();
  const { data, error, isLoading } = useCustomerSignals(window);
  const [bucketFilter, setBucketFilter] = useState<BucketFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('convergence');

  const signals = data?.signals ?? null;

  const visibleSignals = useMemo(() => {
    if (signals == null) return null;
    const filtered =
      bucketFilter === 'all'
        ? signals
        : signals.filter((signal) => signal.bucket === bucketFilter);
    return sortSignals(filtered, sortKey);
  }, [signals, bucketFilter, sortKey]);

  return (
    <>
      <p className={styles.panelSubtitle}>
        Evidence-ranked feature discovery. First-party voice — cancellation
        reasons and comments, deck-ready feedback — plus revealed pain from
        failed conversions, empty-back cards, and funnel drop-offs. Convergence
        counts how many independent streams (said, behavioral, revenue)
        corroborate the same pain; higher ranks first.
      </p>

      <div className={styles.tabHeader}>
        <div className={styles.controls}>
          <label
            htmlFor="customer-signals-bucket"
            className={styles.controlsLabel}
          >
            Bucket
          </label>
          <select
            id="customer-signals-bucket"
            className={`${sharedStyles.select} ${styles.windowSelect}`}
            value={bucketFilter}
            onChange={(e) => setBucketFilter(e.target.value as BucketFilter)}
          >
            {BUCKET_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label
            htmlFor="customer-signals-sort"
            className={styles.controlsLabel}
          >
            Sort
          </label>
          <select
            id="customer-signals-sort"
            className={`${sharedStyles.select} ${styles.windowSelect}`}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="convergence">Convergence</option>
            <option value="count">Count</option>
          </select>
        </div>
      </div>

      {error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {error.message}
        </div>
      )}

      {data?.error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {data.error}
        </div>
      )}

      {visibleSignals != null && renderRows(visibleSignals)}

      {isLoading && data == null && (
        <p className={styles.emptyHint}>Reading customer signals</p>
      )}
    </>
  );
}
