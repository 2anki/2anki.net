import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useCookies } from 'react-cookie';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { getSearchPath } from '../../components/NavigationBar/helpers/getSearchPath';
import { sanitizeRelativeRedirect } from '../../lib/auth/sanitizeRelativeRedirect';
import { stripUrlParam } from '../../lib/stripUrlParam';
import styles from '../../styles/auth.module.css';
import sharedStyles from '../../styles/shared.module.css';

type MagicLinkState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success' };

function MagicLinkPage() {
  const { t } = useTranslation('accountx');
  const [searchParams] = useSearchParams();
  const [, setCookie] = useCookies(['token']);
  const [state, setState] = useState<MagicLinkState>({ status: 'loading' });
  const [retryEmail, setRetryEmail] = useState(() => {
    try {
      return localStorage.getItem('email') ?? '';
    } catch {
      return '';
    }
  });
  const [retrySending, setRetrySending] = useState(false);
  const [retryDone, setRetryDone] = useState(false);

  const token = searchParams.get('token');
  const redirect = sanitizeRelativeRedirect(searchParams.get('redirect'));

  useEffect(() => {
    if (token == null) {
      setState({
        status: 'error',
        message: t('magicLink.invalidOrExpired'),
      });
      return;
    }

    let cancelled = false;
    const validToken = token;
    stripUrlParam('token');

    async function validateToken() {
      try {
        const response = await get2ankiApi().validateMagicToken(
          validToken,
          redirect
        );
        if (cancelled) return;

        if (response.ok) {
          const data = await response.json();
          if (data.purpose === 'password_reset') {
            globalThis.location.href = `/users/r/${data.reset_token}`;
            return;
          }

          setCookie('token', data.token);
          setState({ status: 'success' });
          globalThis.location.href =
            sanitizeRelativeRedirect(data.redirect) ?? getSearchPath('anki');
        } else {
          const errorData = await response.json().catch(() => ({}));
          setState({
            status: 'error',
            message: errorData.message ?? t('magicLink.invalidOrExpired'),
          });
        }
      } catch {
        if (cancelled) return;
        setState({
          status: 'error',
          message: t('magicLink.somethingWrong'),
        });
      }
    }

    validateToken();
    return () => {
      cancelled = true;
    };
  }, [token, redirect, setCookie, t]);

  const handleResendLink = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setRetrySending(true);
    setRetryDone(false);
    try {
      await get2ankiApi().requestMagicLink(retryEmail, 'login', redirect);
      setRetryDone(true);
    } catch {
      setState({
        status: 'error',
        message: t('magicLink.couldNotSend'),
      });
    } finally {
      setRetrySending(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <div className={styles.formPage}>
        <div className={styles.formCard}>
          <h1 className={styles.formTitle}>{t('magicLink.verifying')}</h1>
          <div className={sharedStyles.flexCenter} role="status">
            <div className={sharedStyles.spinner} />
            <span className={sharedStyles.srOnly}>
              {t('magicLink.verifying')}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={styles.formPage}>
        <div className={styles.formCard}>
          <h1 className={styles.formTitle}>{t('magicLink.expiredTitle')}</h1>
          <p className={sharedStyles.formDescription}>{state.message}</p>
          {retryDone ? (
            <p className={styles.helpSuccess}>
              {t('magicLink.newLinkSent', { email: retryEmail })}
            </p>
          ) : (
            <form onSubmit={handleResendLink}>
              <div className={styles.field}>
                <label htmlFor="retry-email">
                  <span>{t('magicLink.emailLabel')}</span>
                  <input
                    id="retry-email"
                    name="email"
                    type="email"
                    value={retryEmail}
                    onChange={(e) => setRetryEmail(e.target.value)}
                    placeholder={t('magicLink.emailPlaceholder')}
                    required
                  />
                </label>
              </div>
              <div className={styles.field}>
                <button
                  type="submit"
                  className={styles.submitButton}
                  disabled={retrySending || retryEmail.length === 0}
                >
                  {retrySending
                    ? t('magicLink.sending')
                    : t('magicLink.sendNewLink')}
                </button>
              </div>
            </form>
          )}
          <p className={styles.footerText}>
            <a rel="noreferrer" href="/login">
              {t('magicLink.backToLogin')}
            </a>
          </p>
        </div>
      </div>
    );
  }

  return null;
}

export default MagicLinkPage;
