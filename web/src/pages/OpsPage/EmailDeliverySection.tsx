import { useState } from 'react';

import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import {
  EMAIL_DELIVERY_WINDOWS,
  EMAIL_FAILURE_MIN_ATTEMPTS,
  EMAIL_FAILURE_RATE_ALERT_PCT,
  EmailDeliveryCategory,
  EmailDeliveryWindow,
} from './emailDeliveryTypes';
import { formatCount } from './opsHelpers';
import { useEmailDelivery } from './useEmailDelivery';
import ChartPanel from './charts/ChartPanel';

const WINDOW_LABEL: Record<EmailDeliveryWindow, string> = {
  '7d': 'Last 7 days',
  '14d': 'Last 14 days',
  '30d': 'Last 30 days',
  '60d': 'Last 60 days',
  '90d': 'Last 90 days',
};

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
  const [window, setWindow] = useState<EmailDeliveryWindow>('30d');
  const { data, error, isLoading } = useEmailDelivery(window);

  return (
    <>
      <div className={styles.tabHeader}>
        <div className={styles.controls}>
          <label
            className={styles.controlsLabel}
            htmlFor="email-delivery-window"
          >
            Window
          </label>
          <select
            id="email-delivery-window"
            className={`${sharedStyles.select} ${styles.windowSelect}`}
            value={window}
            onChange={(event) =>
              setWindow(event.target.value as EmailDeliveryWindow)
            }
          >
            {EMAIL_DELIVERY_WINDOWS.map((value) => (
              <option key={value} value={value}>
                {WINDOW_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

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
        emptyText="No delivery events recorded in this window yet — tracking starts with this deploy."
        autoHeight
      >
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
                <td className={styles.numeric}>{formatCount(row.delivered)}</td>
                <td className={styles.numeric}>{formatCount(row.bounce)}</td>
                <td className={styles.numeric}>{formatCount(row.dropped)}</td>
                <td className={styles.numeric}>{formatCount(row.blocked)}</td>
                <td className={styles.numeric}>{formatCount(row.deferred)}</td>
                <td className={styles.numeric}>
                  {formatCount(row.spamreport)}
                </td>
                <td className={styles.numeric}>{row.failure_rate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartPanel>
    </>
  );
}
