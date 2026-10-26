import { useState } from 'react';

import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import { deleteUser, DeleteUserAccount, DeleteUserError } from './deleteUser';

type Status = 'idle' | 'loading' | 'success' | 'error';

const formatDate = (value: string | null): string =>
  value == null ? 'never' : new Date(value).toLocaleDateString();

function describeAccount(account: DeleteUserAccount): string {
  const pass =
    account.activePass == null
      ? 'no pass'
      : `${account.activePass.kind} pass until ${formatDate(account.activePass.expiresAt)}`;
  return [
    `Account ${account.userId}`,
    `signed up ${formatDate(account.createdAt)}`,
    `last login ${formatDate(account.lastLoginAt)}`,
    `${account.jobs} conversion${account.jobs === 1 ? '' : 's'}`,
    `${account.uploads} upload${account.uploads === 1 ? '' : 's'}`,
    account.activeSubscription ? 'active subscription' : 'no subscription',
    pass,
  ].join(' · ');
}

const isPaid = (account: DeleteUserAccount): boolean =>
  account.activeSubscription || account.activePass != null;

// Preview first, then a typed confirmation. A paid account also needs the
// force box, so a typo can never remove someone's paid access.
export default function DeleteAccountCommand() {
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [force, setForce] = useState(false);
  const [account, setAccount] = useState<DeleteUserAccount | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const reset = (next: string) => {
    setEmail(next);
    setAccount(null);
    setConfirmEmail('');
    setForce(false);
    setStatus('idle');
    setMessage('');
  };

  const preview = async () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      setStatus('error');
      setMessage('Enter the account email first.');
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      const result = await deleteUser({ email: trimmed, dryRun: true });
      setAccount(result.dryRun ? result.account : null);
      setStatus('idle');
    } catch (error) {
      setAccount(null);
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const confirmed =
    account != null &&
    confirmEmail.trim().toLowerCase() === email.trim().toLowerCase() &&
    (!isPaid(account) || force);

  const runDelete = async () => {
    if (!confirmed) {
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      const result = await deleteUser({
        email: email.trim(),
        confirmEmail: confirmEmail.trim(),
        dryRun: false,
        force,
      });
      const userId = result.dryRun ? result.account.userId : result.userId;
      setAccount(null);
      setConfirmEmail('');
      setForce(false);
      setStatus('success');
      setMessage(
        `Deleted account ${userId}. Any Stripe subscription was cancelled first.`
      );
    } catch (error) {
      if (error instanceof DeleteUserError && error.account != null) {
        setAccount(error.account);
      }
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Unknown error');
    }
  };

  return (
    <>
      <section className={`${sharedStyles.surface} ${styles.card}`}>
        <h3 className={styles.cardTitle}>Delete account</h3>
        <p className={styles.panelSubtitle}>
          Deletes one account by email, for people who ask support to remove it.
          Same steps as self-serve deletion: cancels any Stripe subscription,
          revokes Sign in with Apple, then deletes the account and its data.
          Preview first; nothing is deleted until you type the email again.
        </p>
        <div className={styles.controls}>
          <input
            type="email"
            aria-label="Account email to delete"
            placeholder="user@example.com"
            className={styles.textInput}
            value={email}
            onChange={(e) => reset(e.target.value)}
          />
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={() => preview()}
            disabled={status === 'loading'}
          >
            {status === 'loading' && account == null
              ? 'Working…'
              : 'Preview account'}
          </button>
        </div>
        {account != null && (
          <>
            <p className={styles.panelSubtitle}>{describeAccount(account)}</p>
            {isPaid(account) && (
              <label>
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                />{' '}
                Delete even though it has paid access
              </label>
            )}
            <div className={styles.controls}>
              <input
                type="email"
                aria-label="Confirm account email"
                placeholder="Type the email again to confirm"
                className={styles.textInput}
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
              />
              <button
                type="button"
                className={sharedStyles.btnDanger}
                onClick={() => runDelete()}
                disabled={!confirmed || status === 'loading'}
              >
                {status === 'loading' ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </>
        )}
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
    </>
  );
}
