import { SyntheticEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import TopMessage from '../TopMessage/TopMessage';
import { ErrorHandlerType } from '../errors/helpers/getErrorMessage';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { WithGoogleLink } from './WithGoogleLink';
import { WithNotionLink } from './WithNotionLink';
import { WithAppleLink } from './WithAppleLink';
import { WithMicrosoftLink } from './WithMicrosoftLink';
import { getVisibleText } from '../../lib/text/getVisibleText';
import { readSignupOrigin } from '../../lib/signupOrigin';
import { track } from '../../lib/analytics/track';
import {
  UserNotice,
  isIntentionalBackendNotice,
} from '../../lib/errors/UserNotice';
import styles from '../../styles/auth.module.css';

interface Props {
  readonly setErrorMessage: ErrorHandlerType;
  readonly redirect?: string | null;
}

const MIN_PASSWORD_LENGTH = 8;
const SIGNUP_FLAG_KEY = 'signup_completed_tracked';

function isAccountExistsFailure(message: unknown): boolean {
  return typeof message === 'string' && message.includes('already exists');
}

function loginHref(redirect?: string | null): string {
  if (redirect == null) return '/login';
  return `/login?redirect=${encodeURIComponent(redirect)}`;
}

function RegisterForm({ setErrorMessage, redirect }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(localStorage.getItem('email') || '');
  const [tos, setTos] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [accountExists, setAccountExists] = useState(false);
  const signupOrigin = useMemo(
    () =>
      readSignupOrigin(
        globalThis.location?.search ?? '',
        globalThis.sessionStorage ?? null
      ),
    []
  );
  const signupStartedRef = useRef(false);

  useEffect(() => {
    if (signupStartedRef.current) return;
    signupStartedRef.current = true;
    track('signup_started', { method: 'email' });
  }, []);

  const passwordTouched = password.length > 0;
  const passwordMeetsMinimum = password.length >= MIN_PASSWORD_LENGTH;

  const isValid = () =>
    tos &&
    email.length > 0 &&
    email.length < 256 &&
    passwordMeetsMinimum &&
    password.length < 256;

  const handleSubmit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setLoading(true);
    setAccountExists(false);

    try {
      const res = await get2ankiApi().register(
        '',
        email,
        password,
        signupOrigin
      );
      if (res.status === 200) {
        track('signup_completed', { method: 'email' });
        globalThis.sessionStorage?.setItem(SIGNUP_FLAG_KEY, '1');
        globalThis.sessionStorage?.setItem(
          'email_verification_pending',
          'true'
        );
        globalThis.location.href = redirect
          ? `/${redirect.replace(/^\//, '')}`
          : '/upload';
      } else {
        track('signup_failed', { method: 'email' });
        const body = await res.json().catch(() => null);
        const backendMessage =
          typeof body?.message === 'string' ? body.message : null;
        if (isAccountExistsFailure(backendMessage)) {
          if (email.includes('@')) {
            localStorage.setItem('email', email);
          }
          setAccountExists(true);
          setLoading(false);
          return;
        }
        if (
          backendMessage != null &&
          isIntentionalBackendNotice(backendMessage)
        ) {
          setErrorMessage(new UserNotice(backendMessage));
          setLoading(false);
          return;
        }
        setErrorMessage(backendMessage ?? t('auth.register.errorGeneric'));
        setLoading(false);
      }
    } catch (error) {
      console.error('Register submit failed', error);
      setErrorMessage(t('auth.register.errorGeneric'));
      setLoading(false);
    }
  };

  const passwordHelpClass = (() => {
    if (passwordTouched) {
      return passwordMeetsMinimum ? styles.helpSuccess : styles.helpDanger;
    }
    return styles.helpMuted;
  })();

  const passwordHelpText = passwordMeetsMinimum
    ? t('auth.common.passwordHelpGood')
    : t('auth.common.passwordHelpMin');

  return (
    <div className={styles.formPage}>
      <div className={styles.formCard}>
        <TopMessage />
        {accountExists && (
          <div className={styles.recovery} role="alert">
            <p>{t('auth.register.accountExists')}</p>
            <div className={styles.recoveryActions}>
              <Link to={loginHref(redirect)}>{t('auth.register.logIn')}</Link>
              <Link to="/forgot">{t('auth.register.resetPassword')}</Link>
            </div>
          </div>
        )}
        <h1 className={styles.formTitle}>{t('auth.register.title')}</h1>
        <div className={styles.oauthGrid}>
          <WithGoogleLink
            variant="card"
            text={getVisibleText('navigation.register.google')}
            onSelect={() => track('signup_started', { method: 'google' })}
          />
          <WithNotionLink
            variant="card"
            text="Continue with Notion"
            onSelect={() => track('signup_started', { method: 'notion' })}
          />
          <WithMicrosoftLink
            variant="card"
            text={getVisibleText('navigation.register.microsoft')}
            onSelect={() => track('signup_started', { method: 'microsoft' })}
          />
          <WithAppleLink
            variant="card"
            text="Sign in with Apple"
            onSelect={() => track('signup_started', { method: 'apple' })}
          />
        </div>
        <div className={styles.divider}>
          <span className={styles.dividerLabel}>
            {t('auth.register.orSignUpEmail')}
          </span>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="email">
              <span>{t('auth.common.email')}</span>
              <input
                id="email"
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
                name="email"
              />
            </label>
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
                autoComplete="new-password"
                placeholder={t('auth.common.password')}
                aria-describedby="password-help"
              />
            </label>
            <p id="password-help" className={passwordHelpClass}>
              {passwordHelpText}
            </p>
          </div>
          <div className={styles.field}>
            <label htmlFor="tos" className={styles.checkbox}>
              <input
                id="tos"
                name="tos"
                required
                type="checkbox"
                checked={tos}
                onChange={(event) => setTos(event.target.checked)}
              />
              <span>
                {t('auth.register.tosPrefix')}
                <a
                  rel="noreferrer"
                  target="_blank"
                  href="https://alemayhu.notion.site/Terms-of-services-931865161517453b99fb6495e400061d"
                >
                  {t('auth.register.tosTerms')}
                </a>
                {t('auth.register.tosMiddle')}
                <a
                  rel="noreferrer"
                  target="_blank"
                  href="https://alemayhu.notion.site/Privacy-38c6e8238ac04ea9b2485bf488909fd0"
                >
                  {t('auth.register.tosPrivacy')}
                </a>
                .
              </span>
            </label>
          </div>
          <div className={styles.field}>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={!isValid() || loading}
            >
              {loading
                ? t('auth.register.creating')
                : t('auth.register.create')}
            </button>
          </div>
        </form>
        <p className={styles.footerText}>
          {t('auth.register.loginQuestion')}{' '}
          <a rel="noreferrer" href="/login">
            {t('auth.register.logIn')}
          </a>
        </p>
      </div>
    </div>
  );
}

export default RegisterForm;
