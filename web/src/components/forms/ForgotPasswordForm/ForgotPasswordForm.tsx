import { SyntheticEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorHandlerType } from '../../errors/helpers/getErrorMessage';
import CheckYourEmail from '../../CheckYourEmail/CheckYourEmail';
import { get2ankiApi } from '../../../lib/backend/get2ankiApi';
import { UserNotice } from '../../../lib/errors/UserNotice';
import styles from '../../../styles/auth.module.css';
import sharedStyles from '../../../styles/shared.module.css';

interface ForgotPasswordProps {
  setError: ErrorHandlerType;
}

function ForgotPasswordForm({ setError }: Readonly<ForgotPasswordProps>) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(localStorage.getItem('email') || '');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setLoading(true);

    try {
      const response = await get2ankiApi().requestMagicLink(
        email,
        'password_reset'
      );
      if (!response.ok) {
        setError(new UserNotice(t('account:confirmEmail.error')));
        return;
      }
      setSubmitted(true);
    } catch (error) {
      setError(error);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <CheckYourEmail
        email={email}
        onRetry={() => setSubmitted(false)}
        purpose="password_reset"
      />
    );
  }

  return (
    <div className={styles.formPage}>
      <div className={styles.formCard}>
        <h1 className={styles.formTitle}>{t('auth.forgot.title')}</h1>
        <p className={sharedStyles.formDescription}>
          {t('auth.forgot.description')}
        </p>
        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="email">
              <span>{t('auth.common.email')}</span>
              <input
                id="email"
                name="email"
                min="3"
                max="255"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={(event) => {
                  if (event.target.value.includes('@')) {
                    localStorage.setItem('email', event.target.value);
                  }
                }}
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder={t('auth.forgot.emailPlaceholder')}
                required
              />
            </label>
          </div>
          <div className={styles.field}>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading || email.length === 0}
            >
              {loading
                ? t('auth.forgot.sending')
                : t('auth.forgot.sendResetLink')}
            </button>
          </div>
        </form>
        <p className={styles.footerText}>
          <a rel="noreferrer" href="/login">
            {t('auth.forgot.backToLogin')}
          </a>
        </p>
      </div>
    </div>
  );
}

export default ForgotPasswordForm;
