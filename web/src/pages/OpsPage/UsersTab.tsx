import { useState } from 'react';

import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import { grantUnclaimedPass } from './grantUnclaimedPass';
import { setBlockIdIdentity } from './setBlockIdIdentity';
import { changeUserEmail } from './changeUserEmail';
import DeleteAccountCommand from './DeleteAccountCommand';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function UsersTab() {
  const [passId, setPassId] = useState('');
  const [passEmail, setPassEmail] = useState('');
  const [passStatus, setPassStatus] = useState<Status>('idle');
  const [passMessage, setPassMessage] = useState('');
  const [blockIdEmail, setBlockIdEmail] = useState('');
  const [blockIdStatus, setBlockIdStatus] = useState<Status>('idle');
  const [blockIdMessage, setBlockIdMessage] = useState('');
  const [emailChangeCurrent, setEmailChangeCurrent] = useState('');
  const [emailChangeNew, setEmailChangeNew] = useState('');
  const [emailChangeStatus, setEmailChangeStatus] = useState<Status>('idle');
  const [emailChangeMessage, setEmailChangeMessage] = useState('');

  const runSetBlockIdIdentity = async (enabled: boolean) => {
    const email = blockIdEmail.trim();
    if (!email.includes('@')) {
      setBlockIdStatus('error');
      setBlockIdMessage('Enter the account email first.');
      return;
    }
    setBlockIdStatus('loading');
    setBlockIdMessage('');
    try {
      await setBlockIdIdentity(email, enabled);
      setBlockIdStatus('success');
      setBlockIdMessage(
        enabled
          ? `On for ${email}. Ask them to upload the same page again — their existing cards update in place.`
          : `Off for ${email}. Their own card option setting applies again.`
      );
    } catch (error) {
      setBlockIdStatus('error');
      setBlockIdMessage(
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

  const runChangeUserEmail = async () => {
    const current = emailChangeCurrent.trim();
    const next = emailChangeNew.trim();
    if (!current.includes('@')) {
      setEmailChangeStatus('error');
      setEmailChangeMessage('Enter the current account email first.');
      return;
    }
    if (!next.includes('@')) {
      setEmailChangeStatus('error');
      setEmailChangeMessage('Enter the new email first.');
      return;
    }
    setEmailChangeStatus('loading');
    setEmailChangeMessage('');
    try {
      const result = await changeUserEmail(current, next);
      setEmailChangeStatus('success');
      setEmailChangeMessage(
        `Account ${result.userId} now signs in with ${next}. Their subscription stays linked; no email was sent.`
      );
    } catch (error) {
      setEmailChangeStatus('error');
      setEmailChangeMessage(
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  };

  return (
    <>
      <p className={styles.panelTitle}>Users</p>
      <p className={styles.panelSubtitle}>
        Support actions that target one account, looked up by email.
      </p>

      <section className={`${sharedStyles.surface} ${styles.card}`}>
        <h3 className={styles.cardTitle}>Grant unclaimed pass</h3>
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
        <h3 className={styles.cardTitle}>Match cards to Notion blocks</h3>
        <p className={styles.panelSubtitle}>
          Turns &quot;Match cards to their Notion blocks&quot; on or off for an
          account&apos;s future uploads, saved to their card options. Use when a
          user needs their re-upload to update existing cards in place but
          can&apos;t reach the toggle. After you flip it, tell them to upload
          the same page again.
        </p>
        <div className={styles.controls}>
          <input
            type="email"
            aria-label="Match cards account email"
            placeholder="name@example.com"
            className={styles.textInput}
            value={blockIdEmail}
            onChange={(e) => setBlockIdEmail(e.target.value)}
          />
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={() => runSetBlockIdIdentity(true)}
            disabled={blockIdStatus === 'loading'}
          >
            {blockIdStatus === 'loading' ? 'Working…' : 'Turn on'}
          </button>
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={() => runSetBlockIdIdentity(false)}
            disabled={blockIdStatus === 'loading'}
          >
            Turn off
          </button>
        </div>
      </section>

      {blockIdStatus === 'success' && blockIdMessage && (
        <div className={`${sharedStyles.alertSuccess} ${styles.banner}`}>
          {blockIdMessage}
        </div>
      )}
      {blockIdStatus === 'error' && blockIdMessage && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {blockIdMessage}
        </div>
      )}

      <section className={`${sharedStyles.surface} ${styles.card}`}>
        <h3 className={styles.cardTitle}>Change account email</h3>
        <p className={styles.panelSubtitle}>
          Moves a user&apos;s login email to a new address (matched
          case-insensitively) and re-links their subscription in one step. For
          lockout cases where the old inbox is lost. Does not email either
          address or sign the user out — the self-serve flow handles those.
        </p>
        <div className={styles.controls}>
          <input
            type="email"
            aria-label="Current account email"
            placeholder="current@example.com"
            className={styles.textInput}
            value={emailChangeCurrent}
            onChange={(e) => setEmailChangeCurrent(e.target.value)}
          />
          <input
            type="email"
            aria-label="New account email"
            placeholder="new@example.com"
            className={styles.textInput}
            value={emailChangeNew}
            onChange={(e) => setEmailChangeNew(e.target.value)}
          />
          <button
            type="button"
            className={sharedStyles.btnSmall}
            onClick={() => runChangeUserEmail()}
            disabled={emailChangeStatus === 'loading'}
          >
            {emailChangeStatus === 'loading' ? 'Working…' : 'Change email'}
          </button>
        </div>
      </section>

      {emailChangeStatus === 'success' && emailChangeMessage && (
        <div className={`${sharedStyles.alertSuccess} ${styles.banner}`}>
          {emailChangeMessage}
        </div>
      )}
      {emailChangeStatus === 'error' && emailChangeMessage && (
        <div className={`${sharedStyles.alertDanger} ${styles.banner}`}>
          {emailChangeMessage}
        </div>
      )}

      <DeleteAccountCommand />
    </>
  );
}
