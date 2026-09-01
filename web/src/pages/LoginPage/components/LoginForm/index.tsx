import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import TopMessage from '../../../../components/TopMessage/TopMessage';
import CheckYourEmail from '../../../../components/CheckYourEmail/CheckYourEmail';
import { isValidCredentials } from './helpers/isValidCredentials';
import { useHandleLoginSubmit } from './helpers/useHandleLoginSubmit';
import { getVisibleText } from '../../../../lib/text/getVisibleText';
import { STRIPE_CUSTOMER_PORTAL_URL } from '../../../../lib/stripePortal';
import { WithGoogleLink } from '../../../../components/forms/WithGoogleLink';
import { WithNotionLink } from '../../../../components/forms/WithNotionLink';
import { WithAppleLink } from '../../../../components/forms/WithAppleLink';
import { WithMicrosoftLink } from '../../../../components/forms/WithMicrosoftLink';
import { get2ankiApi } from '../../../../lib/backend/get2ankiApi';
import { sanitizeRelativeRedirect } from '../../../../lib/auth/sanitizeRelativeRedirect';
import styles from '../../../../styles/auth.module.css';
import loginStyles from './LoginForm.module.css';

type LoginStep = 'email' | 'password' | 'check-email';

function LoginForm() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<LoginStep>('email');
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const { email, password, loading, onSubmit, setEmail, setPassword } =
    useHandleLoginSubmit((e) => setError((e as Error).message));

  const registerHref =
    searchParams.get('error') === 'upload_limit_exceeded'
      ? '/register?redirect=/pricing'
      : '/register';

  const handleSendMagicLink = async () => {
    setMagicLinkLoading(true);
    setError(null);
    try {
      const redirect = sanitizeRelativeRedirect(searchParams.get('redirect'));
      const response = await get2ankiApi().requestMagicLink(
        email,
        'login',
        redirect
      );
      const body = await response.json().catch(() => ({}));
      if (body?.suppressed) {
        setError(t('auth.login.magicLinkSuppressed'));
        return;
      }
      setStep('check-email');
    } catch {
      setError(t('auth.login.magicLinkError'));
    } finally {
      setMagicLinkLoading(false);
    }
  };

  const handleRetryMagicLink = () => {
    setStep('email');
  };

  if (step === 'check-email') {
    return (
      <CheckYourEmail
        email={email}
        onRetry={handleRetryMagicLink}
        purpose="login"
        onResend={handleSendMagicLink}
      />
    );
  }

  const isEmailStep = step === 'email';

  return (
    <div className={styles.formPage}>
      <img src="/mascot/Notion 1.png" alt="" className={loginStyles.mascot} />
      <div className={styles.formCard}>
        <TopMessage />
        <h1 className={styles.formTitle}>{t('auth.login.title')}</h1>
        <p className={loginStyles.subtitle}>{t('auth.login.subtitle')}</p>
        {isEmailStep ? (
          <>
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
                  required
                />
              </label>
              <p className={styles.helpMuted}>
                {t('auth.login.magicLinkHelp')}
              </p>
            </div>
            <div className={styles.field}>
              <button
                type="button"
                className={styles.submitButton}
                disabled={email.length === 0 || magicLinkLoading}
                onClick={handleSendMagicLink}
                aria-describedby={error ? 'login-error' : undefined}
              >
                {magicLinkLoading
                  ? t('auth.login.sending')
                  : t('auth.login.emailLink')}
              </button>
              {error && (
                <p id="login-error" role="alert" className={styles.helpDanger}>
                  {error}
                </p>
              )}
            </div>
            <p className={styles.footerText}>
              <a
                href="#password"
                onClick={(e) => {
                  e.preventDefault();
                  setError(null);
                  setStep('password');
                }}
              >
                {t('auth.login.usePassword')}
              </a>
            </p>
            <p className={styles.footerText}>
              <a rel="noreferrer" href="/forgot">
                {t('auth.login.forgotPassword')}
              </a>
            </p>
            <div className={styles.divider}>
              <span className={styles.dividerLabel}>
                {t('auth.login.orUseProvider')}
              </span>
            </div>
            <div className={styles.oauthGrid}>
              <WithGoogleLink
                variant="card"
                text={getVisibleText('navigation.login.google')}
              />
              <WithNotionLink variant="card" text="Continue with Notion" />
              <WithMicrosoftLink
                variant="card"
                text={getVisibleText('navigation.login.microsoft')}
              />
              <WithAppleLink variant="card" text="Sign in with Apple" />
            </div>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <div className={styles.field}>
              <label htmlFor="email">
                <span>{t('auth.common.email')}</span>
                <input
                  id="email"
                  name="email"
                  value={email}
                  type="email"
                  autoComplete="email"
                  readOnly
                />
              </label>
              <p className={styles.helpMuted}>
                <a
                  href="#change"
                  onClick={(e) => {
                    e.preventDefault();
                    setError(null);
                    setStep('email');
                  }}
                >
                  {t('auth.login.change')}
                </a>
              </p>
            </div>
            <div className={styles.field}>
              <label htmlFor="password">
                <span>{t('auth.common.password')}</span>
                <input
                  id="password"
                  name="password"
                  min="8"
                  max="255"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  autoComplete="current-password"
                  placeholder={t('auth.common.password')}
                  autoFocus
                />
              </label>
            </div>
            <div className={styles.field}>
              <button
                type="submit"
                className={styles.submitButton}
                disabled={!isValidCredentials(email, password) || loading}
                aria-describedby={error ? 'login-error' : undefined}
              >
                {loading ? t('auth.login.loggingIn') : t('auth.login.logIn')}
              </button>
              {error && (
                <p id="login-error" role="alert" className={styles.helpDanger}>
                  {error}
                </p>
              )}
            </div>
            <p className={styles.footerText}>
              <a rel="noreferrer" href="/forgot">
                {t('auth.login.forgotPassword')}
              </a>
            </p>
            <p className={styles.footerText}>
              <a
                href="#magic-link"
                onClick={(e) => {
                  e.preventDefault();
                  handleSendMagicLink();
                }}
              >
                {magicLinkLoading
                  ? t('auth.login.sending')
                  : t('auth.login.sendLinkInstead')}
              </a>
            </p>
          </form>
        )}
        <p className={styles.footerText}>
          {t('auth.login.noAccount')}{' '}
          <a rel="noreferrer" href={registerHref}>
            {t('auth.login.signUpFree')}
          </a>
        </p>
        <p className={styles.footerText}>
          {t('auth.login.manageSubscriptionHint')}{' '}
          <a rel="noreferrer" href={STRIPE_CUSTOMER_PORTAL_URL}>
            {t('auth.login.manageSubscriptionLink')}
          </a>
        </p>
      </div>
    </div>
  );
}

export default LoginForm;
