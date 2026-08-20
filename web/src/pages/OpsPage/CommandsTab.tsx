import { useState } from 'react';

import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import { syncStripeSubscriptions } from './syncStripeSubscriptions';
import { grantUnclaimedPass } from './grantUnclaimedPass';
import { setChatAttachmentsLifecycle } from './setChatAttachmentsLifecycle';
import { sendPassWinback } from './sendPassWinback';
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
import PaidValueMonitorTab from './PaidValueMonitorTab';

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
  const [lifecycleStatus, setLifecycleStatus] = useState<Status>('idle');
  const [lifecycleMessage, setLifecycleMessage] = useState('');
  const [winbackCampaign, setWinbackCampaign] = useState('');
  const [winbackStatus, setWinbackStatus] = useState<Status>('idle');
  const [winbackMessage, setWinbackMessage] = useState('');
  const [passId, setPassId] = useState('');
  const [passEmail, setPassEmail] = useState('');
  const [passStatus, setPassStatus] = useState<Status>('idle');
  const [passMessage, setPassMessage] = useState('');

  const runWinback = async (dryRun: boolean) => {
    const campaign = winbackCampaign.trim();
    if (campaign.length === 0) {
      setWinbackStatus('error');
      setWinbackMessage('Enter a campaign id first.');
      return;
    }
    setWinbackStatus('loading');
    setWinbackMessage('');
    try {
      const result = await sendPassWinback(campaign, dryRun);
      const buyers = `lapsed pass buyer${result.count === 1 ? '' : 's'}`;
      setWinbackStatus('success');
      setWinbackMessage(
        result.dryRun
          ? `${result.count} ${buyers} would receive the ${result.campaign} win-back email.`
          : `Win-back email sent to ${result.count} ${buyers} for ${result.campaign}.`
      );
    } catch (error) {
      setWinbackStatus('error');
      setWinbackMessage(
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  };

  const runGrantPass = async () => {
    const id = Number(passId.trim());
    const email = passEmail.trim();
    if (!Number.isInteger(id) || id <= 0) {
      setPassStatus('error');
      setPassMessage('Enter a numeric pass id first.');
      return;
    }
    if (!email.includes('@')) {
      setPassStatus('error');
      setPassMessage('Enter the account email first.');
      return;
    }
    setPassStatus('loading');
    setPassMessage('');
    try {
      const result = await grantUnclaimedPass(id, email);
      setPassStatus('success');
      setPassMessage(
        `Granted a ${result.kind} pass to account ${result.userId}, valid until ${new Date(result.expiresAt).toLocaleString()}.`
      );
    } catch (error) {
      setPassStatus('error');
      setPassMessage(error instanceof Error ? error.message : 'Unknown error');
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

  const runLifecycle = async () => {
    setLifecycleStatus('loading');
    setLifecycleMessage('');
    try {
      const result = await setChatAttachmentsLifecycle();
      setLifecycleStatus('success');
      setLifecycleMessage(
        `Applied ${result.ruleId} — the bucket now carries ${result.ruleCount} lifecycle rule${result.ruleCount === 1 ? '' : 's'}.`
      );
    } catch (error) {
      setLifecycleStatus('error');
      setLifecycleMessage(
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
        <h2 className={styles.cardTitle}>Grant unclaimed pass</h2>
        <p className={styles.panelSubtitle}>
          Attaches an unclaimed anonymous pass to an account by email and grants
          the full duration from now — for a buyer whose checkout redirect never
          returned. Find the pass id in the pass unlock monitor. Idempotent for
          the same account.
        </p>
        <div className={styles.controls}>
          <input
            type="number"
            aria-label="Anonymous pass id"
            placeholder="Pass id"
            className={styles.textInput}
            value={passId}
            onChange={(e) => setPassId(e.target.value)}
          />
          <input
            type="email"
            aria-label="Account email"
            placeholder="name@example.com"
            className={styles.textInput}
            value={passEmail}
            onChange={(e) => setPassEmail(e.target.value)}
          />
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={() => runGrantPass()}
            disabled={passStatus === 'loading'}
          >
            {passStatus === 'loading' ? 'Working…' : 'Grant pass'}
          </button>
        </div>
      </section>

      {passStatus === 'success' && passMessage && (
        <div className={`${sharedStyles.alertSuccess} ${styles.banner}`}>
          {passMessage}
        </div>
      )}
      {passStatus === 'error' && passMessage && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {passMessage}
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
        <h2 className={styles.cardTitle}>Pass win-back</h2>
        <p className={styles.panelSubtitle}>
          Emails lapsed Day/Week pass buyers whose pass expired with no active
          pass or subscription a seasonal nudge to come back. Excludes opted-out
          and hard-suppressed addresses and dedupes per campaign. Enter a
          campaign id (e.g. winback-2026-fall), dry-run to check counts, then
          send. Capped at 500 per run.
        </p>
        <div className={styles.controls}>
          <input
            type="text"
            aria-label="Campaign id"
            placeholder="winback-2026-fall"
            className={styles.textInput}
            value={winbackCampaign}
            onChange={(e) => setWinbackCampaign(e.target.value)}
          />
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={() => runWinback(true)}
            disabled={winbackStatus === 'loading'}
          >
            {winbackStatus === 'loading' ? 'Working…' : 'Dry run'}
          </button>
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={() => runWinback(false)}
            disabled={winbackStatus === 'loading'}
          >
            Send win-back
          </button>
        </div>
      </section>

      {winbackStatus === 'success' && winbackMessage && (
        <div className={`${sharedStyles.alertSuccess} ${styles.banner}`}>
          {winbackMessage}
        </div>
      )}
      {winbackStatus === 'error' && winbackMessage && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {winbackMessage}
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
        <h2 className={styles.cardTitle}>Chat attachment expiry</h2>
        <p className={styles.panelSubtitle}>
          Applies the 90-day expiry rule for persisted chat attachments to the
          storage bucket. Idempotent — existing lifecycle rules are kept, only
          the chat-attachments rule is replaced. Run once after deploy, or again
          any time to verify the rule is in place.
        </p>
        <div className={styles.controls}>
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={runLifecycle}
            disabled={lifecycleStatus === 'loading'}
          >
            {lifecycleStatus === 'loading'
              ? 'Applying…'
              : 'Apply 90-day expiry rule'}
          </button>
        </div>
      </section>

      {lifecycleStatus === 'success' && lifecycleMessage && (
        <div className={`${sharedStyles.alertSuccess} ${styles.banner}`}>
          {lifecycleMessage}
        </div>
      )}
      {lifecycleStatus === 'error' && lifecycleMessage && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {lifecycleMessage}
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
      <PaidValueMonitorTab />
    </>
  );
}
