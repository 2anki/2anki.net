import { SyntheticEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorHandlerType } from '../../errors/helpers/getErrorMessage';
import CheckYourEmail from '../../CheckYourEmail/CheckYourEmail';
import { get2ankiApi } from '../../../lib/backend/get2ankiApi';
import { UserNotice } from '../../../lib/errors/UserNotice';
import { isValidEmailShape } from '../../../lib/email/isValidEmailShape';
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
  const [emailInvalid, setEmailInvalid] = useState(false);

  const handleSubmit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (!isValidEmailShape(email)) {
      setEmailInvalid(true);
      return;
    }
    setLoading(true);

    try {
      const response = await get2ankiApi().requestMagicLink(
        email,
        'password_reset'
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (body?.code === 'invalid_email') {
          setEmailInvalid(true);
          return;
        }
        setError(new UserNotice(t('auth.forgot.sendError')));
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
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailInvalid(false);
                }}
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
                aria-invalid={emailInvalid ? true : undefined}
                aria-describedby={emailInvalid ? 'email-error' : undefined}
              />
            </label>
            {emailInvalid && (
              <p id="email-error" className={styles.helpDanger} role="alert">
                {t('auth.register.errorInvalidEmail')}
              </p>
            )}
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
