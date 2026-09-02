import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { post } from '../../../lib/backend/api';
import { track } from '../../../lib/analytics/track';
import { useUserLocals } from '../../../lib/hooks/useUserLocals';
import styles from '../AccountPage.module.css';
import sharedStyles from '../../../styles/shared.module.css';

type Status = 'idle' | 'loading' | 'error';

const fieldColumn = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '0.75rem',
};

export function ChangeEmail() {
  const { t } = useTranslation('accountx');
  const { data, refetch } = useUserLocals();
  const pending = data?.pending_email_change ?? null;

  const [expanded, setExpanded] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);

  const resetForm = () => {
    setPassword('');
    setNewEmail('');
    setStatus('idle');
    setErrorMessage('');
    setNeedsPassword(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMessage('');
    setNeedsPassword(false);

    const res = await post('/api/users/email-change/request', {
      new_email: newEmail,
      password,
    });

    if (res.ok) {
      track('email_change_requested');
      resetForm();
      setExpanded(false);
      await refetch();
      return;
    }

    const body = (await res.json().catch(() => ({}))) as {
      message?: string;
      reason?: string;
    };
    setNeedsPassword(body.reason === 'set_password_first');
    setStatus('error');
    setErrorMessage(body.message ?? t('emailChange.errorGeneric'));
  };

  const handleCancel = async () => {
    await post('/api/users/email-change/cancel', {});
    setExpanded(false);
    resetForm();
    await refetch();
  };

  if (pending && !expanded) {
    return (
      <section className={styles.section}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 'var(--font-semibold)' }}>
          {t('emailChange.pendingTitle')}
        </p>
        <p
          style={{
            margin: '0 0 1rem',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {t('emailChange.pendingBody', { email: pending.new_email })}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={sharedStyles.btnGhost}
            onClick={() => setExpanded(true)}
          >
            {t('emailChange.useDifferent')}
          </button>
          <button
            type="button"
            className={sharedStyles.btnGhost}
            onClick={handleCancel}
          >
            {t('emailChange.cancelChange')}
          </button>
        </div>
      </section>
    );
  }

  if (!expanded) {
    return (
      <section className={styles.section}>
        <button
          type="button"
          className={sharedStyles.btnGhost}
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          style={{
            fontWeight: 'var(--font-semibold)',
            width: '100%',
            textAlign: 'left',
            padding: 0,
          }}
        >
          {t('emailChange.toggle')}
        </button>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <p
        style={{
          margin: '0 0 1rem',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-secondary)',
        }}
      >
        {t('emailChange.description')}
      </p>
      <form onSubmit={handleSubmit} style={fieldColumn}>
        <fieldset
          style={{ border: 'none', padding: 0, margin: 0, ...fieldColumn }}
        >
          <label style={fieldColumn}>
            <span style={{ fontSize: 'var(--text-sm)' }}>
              {t('emailChange.newEmailLabel')}
            </span>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t('emailChange.newEmailPlaceholder')}
              required
              disabled={status === 'loading'}
              autoComplete="email"
            />
          </label>
          <label style={fieldColumn}>
            <span style={{ fontSize: 'var(--text-sm)' }}>
              {t('emailChange.passwordLabel')}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={status === 'loading'}
              autoComplete="current-password"
            />
          </label>
        </fieldset>

        {status === 'error' && (
          <p
            role="alert"
            style={{
              margin: 0,
              color: 'var(--color-danger)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {errorMessage}
            {needsPassword && (
              <>
                {' '}
                <a href="/forgot">{t('emailChange.setPasswordLink')}</a>
              </>
            )}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="submit"
            className={sharedStyles.btnPrimary}
            disabled={status === 'loading' || !newEmail || !password}
          >
            {status === 'loading'
              ? t('emailChange.sending')
              : t('emailChange.submit')}
          </button>
          <button
            type="button"
            className={sharedStyles.btnGhost}
            onClick={() => {
              setExpanded(false);
              resetForm();
            }}
          >
            {t('emailChange.cancel')}
          </button>
        </div>
      </form>
    </section>
  );
}
