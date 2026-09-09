import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import {
  EMAIL_FAILURE_MIN_ATTEMPTS,
  EMAIL_FAILURE_RATE_ALERT_PCT,
  EmailDeliveryCategory,
} from './emailDeliveryTypes';
import { formatCount } from './opsHelpers';
import { useOpsWindow } from './opsWindow';
import { useEmailDelivery } from './useEmailDelivery';
import ChartPanel from './charts/ChartPanel';

function attempts(row: EmailDeliveryCategory): number {
  return row.delivered + row.bounce + row.dropped + row.blocked;
}

function isFailing(row: EmailDeliveryCategory): boolean {
  return (
    attempts(row) >= EMAIL_FAILURE_MIN_ATTEMPTS &&
    row.failure_rate >= EMAIL_FAILURE_RATE_ALERT_PCT
  );
}

export default function EmailDeliverySection() {
  const window = useOpsWindow();
  const { data, error, isLoading } = useEmailDelivery(window);

  return (
    <>
      {error != null && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          /api/ops/email-delivery failed: {error.message}
        </div>
      )}

      <ChartPanel
        title="Delivery by template"
        subtitle={`SendGrid events per template category — badge marks ${EMAIL_FAILURE_RATE_ALERT_PCT}%+ failure with ${EMAIL_FAILURE_MIN_ATTEMPTS}+ attempts`}
        isLoading={isLoading}
        isEmpty={(data?.by_category.length ?? 0) === 0}
        emptyText="No delivery events recorded in this window."
        autoHeight
      >
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Template</th>
                <th>Delivered</th>
                <th>Bounce</th>
                <th>Dropped</th>
                <th>Blocked</th>
                <th>Deferred</th>
                <th>Spam</th>
                <th>Unsub</th>
                <th>Failure</th>
              </tr>
            </thead>
            <tbody>
              {(data?.by_category ?? []).map((row) => (
                <tr key={row.category}>
                  <td>
                    {row.category}
                    {isFailing(row) && (
                      <span className={styles.spendAlertBadge}>
                        {row.failure_rate}% failing
                      </span>
                    )}
                  </td>
                  <td className={styles.numeric}>
                    {formatCount(row.delivered)}
                  </td>
                  <td className={styles.numeric}>{formatCount(row.bounce)}</td>
                  <td className={styles.numeric}>{formatCount(row.dropped)}</td>
                  <td className={styles.numeric}>{formatCount(row.blocked)}</td>
                  <td className={styles.numeric}>
                    {formatCount(row.deferred)}
                  </td>
                  <td className={styles.numeric}>
                    {formatCount(row.spamreport)}
                  </td>
                  <td className={styles.numeric}>
                    {formatCount(row.unsubscribe)}
                  </td>
                  <td className={styles.numeric}>{row.failure_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartPanel>
    </>
  );
}
