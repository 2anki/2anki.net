import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useCookies } from 'react-cookie';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { sanitizeRelativeRedirect } from '../../lib/auth/sanitizeRelativeRedirect';
import { stripUrlParam } from '../../lib/stripUrlParam';
import { NoIndex } from '../../components/NoIndex/NoIndex';
import styles from '../../styles/auth.module.css';
import sharedStyles from '../../styles/shared.module.css';

type MagicLinkPurpose = 'login' | 'password_reset';

type MagicLinkState =
  | { status: 'loading' }
  | {
      status: 'confirm';
      token: string;
      purpose: MagicLinkPurpose;
      email: string;
      sending: boolean;
      notice?: string;
    }
  | { status: 'error'; message: string }
  | { status: 'unavailable' }
  | { status: 'success' };

interface MagicLinkAnswer {
  token?: string;
  redirect?: string;
  purpose?: string;
  reset_token?: string;
  confirm?: boolean;
  signedIn?: boolean;
  email?: string;
}

interface MagicLinkReply {
  ok: boolean;
  status: number;
  data: MagicLinkAnswer;
}

const CONFIRM_NEEDED = 428;
const ALREADY_SIGNED_IN = 409;
const LINK_REFUSED = 400;
const SERVER_FAULT = 500;

async function readReply(request: Promise<Response>): Promise<MagicLinkReply> {
  const response = await request;
  if (response.ok) {
    return { ok: true, status: response.status, data: await response.json() };
  }
  return {
    ok: false,
    status: response.status,
    data: await response.json().catch(() => ({})),
  };
}

function MagicLinkVerification() {
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
  const [openAttempt, setOpenAttempt] = useState(0);

  const token = searchParams.get('token');
  const redirect = sanitizeRelativeRedirect(searchParams.get('redirect'));
  const verification = useRef<{
    token: string;
    attempt: number;
    reply: Promise<MagicLinkReply>;
  } | null>(null);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const confirmNotice = state.status === 'confirm' ? state.notice : undefined;

  useEffect(() => {
    if (state.status === 'confirm') {
      confirmHeading.current?.focus();
    }
  }, [state.status]);

  useEffect(() => {
    if (confirmNotice != null) {
      confirmButton.current?.focus();
    }
  }, [confirmNotice]);

  const follow = useCallback(
    ({ ok, status, data }: MagicLinkReply, linkToken: string) => {
      if (status === CONFIRM_NEEDED && data.email != null) {
        setState({
          status: 'confirm',
          token: linkToken,
          purpose:
            data.purpose === 'password_reset' ? 'password_reset' : 'login',
          email: data.email,
          sending: false,
        });
        return;
      }
      if (status === ALREADY_SIGNED_IN) {
        setState({ status: 'success' });
        globalThis.location.href =
          sanitizeRelativeRedirect(data.redirect) ?? '/search';
        return;
      }
      if (status >= SERVER_FAULT) {
        setState({ status: 'unavailable' });
        return;
      }
      if (!ok) {
        setState({ status: 'error', message: t('magicLink.invalidOrExpired') });
        return;
      }
      if (data.purpose === 'password_reset' && data.reset_token != null) {
        globalThis.location.href = `/users/r/${data.reset_token}`;
        return;
      }
      if (data.token != null) {
        setCookie('token', data.token);
      }
      setState({ status: 'success' });
      globalThis.location.href =
        sanitizeRelativeRedirect(data.redirect) ?? '/search';
    },
    [setCookie, t]
  );

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

    if (
      verification.current?.token !== validToken ||
      verification.current.attempt !== openAttempt
    ) {
      verification.current = {
        token: validToken,
        attempt: openAttempt,
        reply: readReply(
          get2ankiApi().validateMagicToken(validToken, redirect)
        ),
      };
    }
    const { reply } = verification.current;

    async function validateToken() {
      try {
        const answer = await reply;
        if (cancelled) return;
        follow(answer, validToken);
      } catch {
        if (cancelled) return;
        setState({ status: 'unavailable' });
      }
    }

    validateToken();
    return () => {
      cancelled = true;
    };
  }, [token, redirect, follow, t, openAttempt]);

  const retryOpen = () => {
    setState({ status: 'loading' });
    setOpenAttempt((attempt) => attempt + 1);
  };

  const keepConfirming = useCallback(() => {
    setState((current) =>
      current.status === 'confirm'
        ? { ...current, sending: false, notice: t('magicLink.confirmRetry') }
        : current
    );
  }, [t]);

  const handleConfirm = async (linkToken: string) => {
    setState((current) =>
      current.status === 'confirm'
        ? { ...current, sending: true, notice: undefined }
        : current
    );
    try {
      const reply = await readReply(
        get2ankiApi().confirmMagicLink(linkToken, redirect)
      );
      const linkStillUsable =
        !reply.ok &&
        reply.status !== LINK_REFUSED &&
        reply.status !== ALREADY_SIGNED_IN;
      if (linkStillUsable) {
        keepConfirming();
        return;
      }
      follow(reply, linkToken);
    } catch {
      keepConfirming();
    }
  };

  const handleResendLink = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setRetrySending(true);
    setRetryDone(false);
    try {
      const response = await get2ankiApi().requestMagicLink(
        retryEmail,
        'login',
        redirect
      );
      if (!response.ok) {
        throw new Error('magic link not sent');
      }
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

  if (state.status === 'confirm') {
    const isReset = state.purpose === 'password_reset';
    const actionLabel = isReset
      ? t('magicLink.confirmResetButton')
      : t('magicLink.confirmLoginButton');
    return (
      <div className={styles.formPage}>
        <div className={styles.formCard}>
          <h1
            className={styles.formTitle}
            data-hj-suppress
            tabIndex={-1}
            ref={confirmHeading}
          >
            {isReset
              ? t('magicLink.confirmResetTitle', { email: state.email })
              : t('magicLink.confirmLoginTitle', { email: state.email })}
          </h1>
          <p className={sharedStyles.formDescription}>
            {isReset
              ? t('magicLink.confirmResetHint')
              : t('magicLink.confirmLoginHint')}
          </p>
          {state.notice != null && (
            <p className={sharedStyles.formDescription} role="alert">
              {state.notice}
            </p>
          )}
          <div className={styles.field}>
            <button
              ref={confirmButton}
              type="button"
              className={styles.submitButton}
              disabled={state.sending}
              onClick={() => handleConfirm(state.token)}
            >
              {state.sending ? t('magicLink.confirming') : actionLabel}
            </button>
          </div>
          <p className={styles.footerText}>
            <a rel="noreferrer" href="/login">
              {t('magicLink.backToLogin')}
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <div className={styles.formPage}>
        <div className={styles.formCard}>
          <h1 className={styles.formTitle}>
            {t('magicLink.unavailableTitle')}
          </h1>
          <p className={sharedStyles.formDescription}>
            {t('magicLink.somethingWrong')}
          </p>
          <div className={styles.field}>
            <button
              type="button"
              className={styles.submitButton}
              onClick={retryOpen}
            >
              {t('magicLink.tryAgain')}
            </button>
          </div>
          <p className={styles.footerText}>
            <a rel="noreferrer" href="/login">
              {t('magicLink.backToLogin')}
            </a>
          </p>
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

function MagicLinkPage() {
  return (
    <>
      <NoIndex />
      <MagicLinkVerification />
    </>
  );
}

export default MagicLinkPage;
