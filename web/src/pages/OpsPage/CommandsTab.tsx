import { useState } from 'react';

import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import { syncStripeSubscriptions } from './syncStripeSubscriptions';
import { grantDeveloperAccess } from './grantDeveloperAccess';
import {
  deleteInactiveUsers,
  DeleteInactiveUsersResponse,
} from './deleteInactiveUsers';
import {
  getOrphanedSubscriptions,
  reconcileOrphanedSubscriptions,
  OrphanedSubscriptionsResponse,
  ReconcileOrphanedSubscriptionsResponse,
} from './orphanedSubscriptions';
import PassUnlockMonitorTab from './PassUnlockMonitorTab';

type Status = 'idle' | 'loading' | 'success' | 'error';

function formatDeleteResult(result: DeleteInactiveUsersResponse): string {
  if (result.dryRun) {
    return `${result.count} account${result.count === 1 ? '' : 's'} would be deleted.`;
  }
  return `Deleted ${result.count} account${result.count === 1 ? '' : 's'}.`;
}

function formatReconcileResult(
  result: ReconcileOrphanedSubscriptionsResponse
): string {
  return `${result.found} found, ${result.emailed} emailed, ${result.skippedRecentlyNotified} skipped (notified in last 14 days), ${result.skippedNoEmail} skipped (no email).`;
}

async function callInactivityWarnings(
  dryRun: boolean
): Promise<{ count: number; dryRun: boolean }> {
  const response = await fetch(
    `/api/ops/send-inactivity-warnings?dryRun=${dryRun}`,
    { method: 'POST', credentials: 'include' }
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.message ?? `${response.status} ${response.statusText}`
    );
  }
  return response.json();
}

export default function CommandsTab() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [syncStatus, setSyncStatus] = useState<Status>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [deleteStatus, setDeleteStatus] = useState<Status>('idle');
  const [deleteMessage, setDeleteMessage] = useState('');
  const [orphanStatus, setOrphanStatus] = useState<Status>('idle');
  const [orphanMessage, setOrphanMessage] = useState('');
  const [orphans, setOrphans] = useState<
    OrphanedSubscriptionsResponse['orphans']
  >([]);
  const [devEmail, setDevEmail] = useState('');
  const [devStatus, setDevStatus] = useState<Status>('idle');
  const [devMessage, setDevMessage] = useState('');

  const runDeveloperAccess = async (grant: boolean) => {
    const email = devEmail.trim();
    if (email.length === 0) {
      setDevStatus('error');
      setDevMessage('Enter an email first.');
      return;
    }
    setDevStatus('loading');
    setDevMessage('');
    try {
      const result = await grantDeveloperAccess(email, grant);
      setDevStatus('success');
      setDevMessage(
        `${grant ? 'Granted' : 'Revoked'} developer access for ${email} (${result.updated} account${result.updated === 1 ? '' : 's'}).`
      );
    } catch (error) {
      setDevStatus('error');
      setDevMessage(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const run = async (dryRun: boolean) => {
    setStatus('loading');
    setMessage('');
    try {
      const result = await callInactivityWarnings(dryRun);
      const label = result.dryRun
        ? `${result.count} account${result.count === 1 ? '' : 's'} would receive a warning email.`
        : `Warning email sent to ${result.count} account${result.count === 1 ? '' : 's'}.`;
      setStatus('success');
      setMessage(label);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const runStripeSync = async () => {
    setSyncStatus('loading');
    setSyncMessage('');
    try {
      const result = await syncStripeSubscriptions();
      setSyncStatus('success');
      setSyncMessage(result.message);
    } catch (error) {
      setSyncStatus('error');
      setSyncMessage(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const runDelete = async (dryRun: boolean) => {
    setDeleteStatus('loading');
    setDeleteMessage('');
    try {
      const result = await deleteInactiveUsers(dryRun);
      setDeleteStatus('success');
      setDeleteMessage(formatDeleteResult(result));
    } catch (error) {
      setDeleteStatus('error');
      setDeleteMessage(
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  };

  const runOrphanPreview = async () => {
    setOrphanStatus('loading');
    setOrphanMessage('');
    try {
      const result = await getOrphanedSubscriptions();
      setOrphans(result.orphans);
      setOrphanStatus('success');
      setOrphanMessage(
        `${result.count} orphaned active subscription${
          result.count === 1 ? '' : 's'
        }.`
      );
    } catch (error) {
      setOrphanStatus('error');
      setOrphanMessage(
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  };

  const runOrphanReconcile = async () => {
    setOrphanStatus('loading');
    setOrphanMessage('');
    try {
      const result = await reconcileOrphanedSubscriptions();
      setOrphanStatus('success');
      setOrphanMessage(formatReconcileResult(result));
    } catch (error) {
      setOrphanStatus('error');
      setOrphanMessage(
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  };

  return (
    <>
      <p className={styles.panelTitle}>Commands</p>
      <p className={styles.panelSubtitle}>
        Manual ops actions. Run dry-run first to validate counts before sending.
      </p>

      <section className={`${sharedStyles.surface} ${styles.card}`}>
        <h2 className={styles.cardTitle}>Developer access</h2>
        <p className={styles.panelSubtitle}>
          Grant or revoke access to the Developers API surface for one account
          by email. Grants access without making the account lifetime.
        </p>
        <div className={styles.controls}>
          <input
            type="email"
            aria-label="Account email"
            placeholder="name@example.com"
            className={styles.textInput}
            value={devEmail}
            onChange={(e) => setDevEmail(e.target.value)}
          />
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={() => runDeveloperAccess(true)}
            disabled={devStatus === 'loading'}
          >
            {devStatus === 'loading' ? 'Working…' : 'Grant'}
          </button>
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={() => runDeveloperAccess(false)}
            disabled={devStatus === 'loading'}
          >
            Revoke
          </button>
        </div>
      </section>

      {devStatus === 'success' && devMessage && (
        <div className={`${sharedStyles.alertSuccess} ${styles.banner}`}>
          {devMessage}
        </div>
      )}
      {devStatus === 'error' && devMessage && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {devMessage}
        </div>
      )}

      <section className={`${sharedStyles.surface} ${styles.card}`}>
        <h2 className={styles.cardTitle}>Inactivity warnings</h2>
        <p className={styles.panelSubtitle}>
          Finds free accounts inactive for 6+ months (excludes lifetime and
          active subscribers) and sends a deletion warning email. Capped at 500
          per run.
        </p>
        <div className={styles.controls}>
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={() => run(true)}
            disabled={status === 'loading'}
          >
            {status === 'loading' ? 'Working…' : 'Dry run'}
          </button>
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={() => run(false)}
            disabled={status === 'loading'}
          >
            Send warnings
          </button>
        </div>
      </section>

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

      <section className={`${sharedStyles.surface} ${styles.card}`}>
        <h2 className={styles.cardTitle}>Stripe subscriptions</h2>
        <p className={styles.panelSubtitle}>
          Pulls active Stripe subscriptions into the database and reconciles
          each active row against Stripe. Use this to provision a paying user
          whose subscription did not land via webhook. Runs in the background —
          check the server logs for the result.
        </p>
        <div className={styles.controls}>
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={runStripeSync}
            disabled={syncStatus === 'loading'}
          >
            {syncStatus === 'loading' ? 'Starting…' : 'Sync now'}
          </button>
        </div>
      </section>

      {syncStatus === 'success' && syncMessage && (
        <div className={`${sharedStyles.alertSuccess} ${styles.banner}`}>
          {syncMessage}
        </div>
      )}
      {syncStatus === 'error' && syncMessage && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {syncMessage}
        </div>
      )}

      <section className={`${sharedStyles.surface} ${styles.card}`}>
        <h2 className={styles.cardTitle}>Delete inactive accounts</h2>
        <p className={styles.panelSubtitle}>
          Permanently deletes free accounts that were warned 14+ days ago and
          have not logged in since, plus inactive free accounts whose email
          address hard-bounced or was dropped — the warning email can never
          reach them. Excludes lifetime and active subscribers. Capped at 100
          per run. Check candidates first — deletion cannot be undone.
        </p>
        <div className={styles.controls}>
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={() => runDelete(true)}
            disabled={deleteStatus === 'loading'}
          >
            {deleteStatus === 'loading' ? 'Working…' : 'Check candidates'}
          </button>
          <button
            type="button"
            className={sharedStyles.btnDanger}
            onClick={() => runDelete(false)}
            disabled={deleteStatus === 'loading'}
          >
            Delete inactive accounts
          </button>
        </div>
      </section>

      {deleteStatus === 'success' && deleteMessage && (
        <div className={`${sharedStyles.alertSuccess} ${styles.banner}`}>
          {deleteMessage}
        </div>
      )}
      {deleteStatus === 'error' && deleteMessage && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {deleteMessage}
        </div>
      )}

      <section className={`${sharedStyles.surface} ${styles.card}`}>
        <h2 className={styles.cardTitle}>Orphaned subscriptions</h2>
        <p className={styles.panelSubtitle}>
          Finds active subscriptions where the paid email, linked email, and
          Stripe customer id match no account — so the payer is not getting
          premium. Preview first, then email each payer how to connect their
          subscription. Nothing is auto-created or auto-linked. An address
          emailed in the last 14 days is skipped.
        </p>
        <div className={styles.controls}>
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={runOrphanPreview}
            disabled={orphanStatus === 'loading'}
          >
            {orphanStatus === 'loading' ? 'Working…' : 'Preview orphans'}
          </button>
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={runOrphanReconcile}
            disabled={orphanStatus === 'loading'}
          >
            Send recovery emails
          </button>
        </div>
        {orphans.length > 0 && (
          <ul className={styles.panelSubtitle}>
            {orphans.map((orphan) => (
              <li key={orphan.id} style={{ fontWeight: 500 }}>
                <span data-hj-suppress>{orphan.email}</span>
                {orphan.stripeProductId ? ` — ${orphan.stripeProductId}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      {orphanStatus === 'success' && orphanMessage && (
        <div className={`${sharedStyles.alertSuccess} ${styles.banner}`}>
          {orphanMessage}
        </div>
      )}
      {orphanStatus === 'error' && orphanMessage && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {orphanMessage}
        </div>
      )}

      <PassUnlockMonitorTab />
    </>
  );
}
