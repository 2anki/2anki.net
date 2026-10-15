import { ReactNode, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  replayPendingPurchaseConversions,
  reportPurchaseConversion,
} from '../../lib/analytics/reportPurchaseConversion';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import sharedStyles from '../../styles/shared.module.css';
import styles from './AnkifyPage.module.css';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { Backend } from '../../lib/backend/Backend';
import AnkifyClient from '../../lib/interfaces/AnkifyClient';
import { Skeleton } from '../../components/Skeleton/Skeleton';

const QUERY_KEY = ['ankify-clients'];
const READINESS_QUERY_KEY = ['ankify-active-ready'];
import { acknowledgeAnkiWeb } from '../../lib/data_layer/userPreferencesSync';
const ANKI_WEB_ACK_KEY = 'ankify_anki_web_acknowledged';
const SESSION_URL_PREFIX = 'ankify_session_url:';
const STARTING_TIMEOUT_MS = 45_000;

const sessionUrlKey = (clientId: number) => `${SESSION_URL_PREFIX}${clientId}`;

const writeCachedSessionUrl = (clientId: number, url: string | null) => {
  try {
    if (url == null) {
      globalThis.localStorage?.removeItem(sessionUrlKey(clientId));
    } else {
      globalThis.localStorage?.setItem(sessionUrlKey(clientId), url);
    }
  } catch {}
};

const readCachedSessionUrl = (clientId: number): string | null => {
  try {
    return globalThis.localStorage?.getItem(sessionUrlKey(clientId)) ?? null;
  } catch {
    return null;
  }
};

const readSignedInAcknowledged = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(ANKI_WEB_ACK_KEY) === 'true';
  } catch {
    return false;
  }
};

interface Props {
  readonly backend?: Backend;
}

export default function AnkifySetupPage({ backend }: Props) {
  const { t } = useTranslation('ankify');
  const api = backend ?? get2ankiApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [signedInAcknowledged, setSignedInAcknowledged] = useState<boolean>(
    readSignedInAcknowledged
  );

  const { data, isLoading } = useQuery<AnkifyClient[]>({
    queryKey: QUERY_KEY,
    queryFn: () => api.listAnkifyClients(),
  });

  const activeClient = (data ?? []).find((c) => c.status === 'active');
  const hasActiveClient = activeClient != null;

  const [startingTimedOut, setStartingTimedOut] = useState(false);

  const readiness = useQuery({
    queryKey: READINESS_QUERY_KEY,
    queryFn: () => api.checkAnkifyActiveClientReady(),
    enabled: hasActiveClient && !startingTimedOut,
    refetchInterval: (query) =>
      (query.state.data as { ready?: boolean } | undefined)?.ready === true
        ? false
        : 2000,
  });

  const containerReady = readiness.data?.ready === true;

  const [searchParams, setSearchParams] = useSearchParams();
  const { data: userLocals, isLoading: userLocalsLoading } = useUserLocals();

  const [checkoutSessionId] = useState<string | null>(() => {
    const sessionId = searchParams.get('session_id');
    return searchParams.get('checkout') === 'success' &&
      sessionId != null &&
      sessionId.length > 0
      ? sessionId
      : null;
  });

  const buyerId = userLocals?.user?.id;
  const buyerEmail = userLocals?.user?.email;

  useEffect(() => {
    if (userLocalsLoading) {
      return;
    }
    replayPendingPurchaseConversions(
      buyerId == null ? null : { id: buyerId, email: buyerEmail }
    );
  }, [buyerId, buyerEmail, userLocalsLoading]);

  useEffect(() => {
    if (userLocalsLoading || checkoutSessionId == null) {
      return;
    }
    void reportPurchaseConversion(
      checkoutSessionId,
      buyerId == null ? null : { id: buyerId, email: buyerEmail }
    );
  }, [checkoutSessionId, buyerId, buyerEmail, userLocalsLoading]);

  useEffect(() => {
    if (checkoutSessionId == null) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    if (!next.has('session_id') && !next.has('checkout')) {
      return;
    }
    next.delete('session_id');
    next.delete('checkout');
    setSearchParams(next, { replace: true });
  }, [checkoutSessionId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!hasActiveClient || containerReady) {
      setStartingTimedOut(false);
      return;
    }
    const startedAt =
      activeClient?.created_at == null
        ? Date.now()
        : new Date(activeClient.created_at).getTime();
    const remaining = startedAt + STARTING_TIMEOUT_MS - Date.now();
    if (remaining <= 0) {
      setStartingTimedOut(true);
      return;
    }
    const timer = setTimeout(() => setStartingTimedOut(true), remaining);
    return () => clearTimeout(timer);
  }, [hasActiveClient, containerReady, activeClient?.created_at]);

  const respin = useMutation({
    mutationFn: () => api.respinAnkifyClient(),
    onSuccess: (client) => {
      if (client.session_url != null) {
        writeCachedSessionUrl(client.id, client.session_url);
      }
      setStartingTimedOut(false);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: READINESS_QUERY_KEY });
    },
  });

  const ankiWebStatus = useQuery({
    queryKey: ['ankify-anki-web-status'],
    queryFn: () => api.checkAnkifyAnkiWebStatus(),
    enabled: hasActiveClient && containerReady,
    refetchInterval: (query) =>
      (query.state.data as { status?: string } | undefined)?.status === 'linked'
        ? false
        : 15_000,
  });

  const provision = useMutation({
    mutationFn: () => api.provisionAnkifyClient(),
    onSuccess: (client) => {
      if (client.session_url != null) {
        writeCachedSessionUrl(client.id, client.session_url);
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const reissueSession = useMutation({
    mutationFn: (id: number) => api.reissueAnkifySessionUrl(id),
    onSuccess: (client) => {
      if (client.session_url != null) {
        writeCachedSessionUrl(client.id, client.session_url);
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  useEffect(() => {
    if (activeClient == null) return;
    if (
      activeClient.has_active_session === false &&
      readCachedSessionUrl(activeClient.id) != null
    ) {
      writeCachedSessionUrl(activeClient.id, null);
    }
  }, [activeClient?.id, activeClient?.has_active_session]);

  const reissueMutate = reissueSession.mutate;
  const reissueIsPending = reissueSession.isPending;
  useEffect(() => {
    if (activeClient == null) return;
    if (!containerReady) return;
    if (reissueIsPending) return;
    if (activeClient.session_url != null) return;
    if (
      activeClient.has_active_session !== false &&
      readCachedSessionUrl(activeClient.id) != null
    ) {
      return;
    }
    reissueMutate(activeClient.id);
  }, [
    activeClient?.id,
    activeClient?.has_active_session,
    activeClient?.session_url,
    containerReady,
    reissueIsPending,
    reissueMutate,
  ]);

  const acknowledgeAnkiWebSignIn = () => {
    setSignedInAcknowledged(true);
    acknowledgeAnkiWeb().catch(() => undefined);
  };

  const verifySignIn = useMutation({
    mutationFn: () => api.checkAnkifyAnkiWebStatus(),
    onSuccess: (result) => {
      if (result.status === 'linked') {
        acknowledgeAnkiWebSignIn();
      }
    },
  });

  useEffect(() => {
    if (
      ankiWebStatus.data?.status === 'linked' &&
      hasActiveClient &&
      !signedInAcknowledged
    ) {
      acknowledgeAnkiWebSignIn();
    }
  }, [ankiWebStatus.data?.status, hasActiveClient, signedInAcknowledged]);

  useEffect(() => {
    if (!hasActiveClient && signedInAcknowledged) {
      setSignedInAcknowledged(false);
      try {
        globalThis.localStorage?.removeItem(ANKI_WEB_ACK_KEY);
      } catch {}
    }
  }, [hasActiveClient, signedInAcknowledged]);

  useEffect(() => {
    if (!isLoading && hasActiveClient && signedInAcknowledged) {
      navigate('/ankify', { replace: true });
    }
  }, [isLoading, hasActiveClient, signedInAcknowledged, navigate]);

  if (isLoading) {
    return (
      <main className={styles.setupTakeover}>
        <Skeleton width="60%" height="2rem" />
        <Skeleton width="80%" height="1rem" />
      </main>
    );
  }

  const ankiUrlFor = (client: AnkifyClient): string | null => {
    if (client.session_url != null) return client.session_url;
    if (client.has_active_session === false) return null;
    return readCachedSessionUrl(client.id);
  };

  const renderStartAnkiStep = () => (
    <section className={styles.setupActiveStep}>
      <p className={styles.setupActiveStepLabel}>{t('setup.step1')}</p>
      <h2 className={styles.setupActiveStepTitle}>{t('setup.startAnki')}</h2>
      <p className={styles.setupActiveStepHint}>{t('setup.startHint')}</p>
      {provision.isPending ? (
        <div
          className={styles.setupActiveStepActions}
          role="status"
          aria-live="polite"
        >
          <Skeleton width="11rem" height="2.25rem" radius="0.4rem" />
          <p className={styles.setupActiveStepHint}>
            {t('setup.startingHint')}
          </p>
        </div>
      ) : (
        <div className={styles.setupActiveStepActions}>
          <button
            type="button"
            className={`${sharedStyles.btnPrimary} ${styles.inlineButton}`}
            onClick={() => provision.mutate()}
            disabled={provision.isPending}
          >
            {t('setup.startAnki')}
          </button>
        </div>
      )}
      {provision.error &&
        (() => {
          const err = provision.error as Error & { status?: number };
          const body =
            err.status === 503
              ? t('setup.startError503')
              : t('setup.startError');
          return (
            <div className={styles.provisionErrorBlock} role="alert">
              <p className={styles.provisionErrorBody}>{body}</p>
            </div>
          );
        })()}
    </section>
  );

  const renderStartingStep = () => (
    <section className={styles.setupActiveStep}>
      <p className={styles.setupActiveStepLabel}>{t('setup.step1')}</p>
      <h2 className={styles.setupActiveStepTitle}>{t('setup.startAnki')}</h2>
      {startingTimedOut ? (
        <>
          <div className={styles.provisionErrorBlock} role="alert">
            <p className={styles.provisionErrorTitle}>
              {t('setup.takingLonger')}
            </p>
            <p className={styles.provisionErrorBody}>
              {t('setup.mostRetriesSucceed')}
            </p>
          </div>
          <div className={styles.setupActiveStepActions}>
            <button
              type="button"
              className={`${sharedStyles.btnPrimary} ${styles.inlineButton}`}
              onClick={() => respin.mutate()}
              disabled={respin.isPending}
            >
              {respin.isPending ? t('setup.restarting') : t('setup.tryAgain')}
            </button>
          </div>
          {respin.error && (
            <p
              className={styles.provisionErrorBody}
              role="alert"
              aria-live="polite"
            >
              {t('setup.restartError')}
            </p>
          )}
        </>
      ) : (
        <div
          className={styles.setupActiveStepActions}
          role="status"
          aria-live="polite"
        >
          <Skeleton width="11rem" height="2.25rem" radius="0.4rem" />
          <p className={styles.setupActiveStepHint}>
            {t('setup.startingHint')}
          </p>
        </div>
      )}
    </section>
  );

  const renderSignInStep = (client: AnkifyClient) => {
    const verifyStatus = verifySignIn.data?.status;
    const sessionUrl = ankiUrlFor(client);
    return (
      <section className={styles.setupActiveStep}>
        <p className={styles.setupActiveStepLabel}>{t('setup.step2')}</p>
        <h2 className={styles.setupActiveStepTitle}>
          {t('setup.signInAnkiWeb')}
        </h2>
        <p className={styles.setupActiveStepHint}>
          {t('setup.signInHintBefore')}
          <strong>Sync</strong>
          {t('setup.signInHintAfter')}
        </p>
        <div className={styles.setupActiveStepActions}>
          {sessionUrl == null ? (
            <button
              type="button"
              className={`${sharedStyles.btnSecondary} ${styles.inlineButton}`}
              disabled
            >
              {t('setup.opening')}
            </button>
          ) : (
            <a
              href={sessionUrl}
              target="_blank"
              rel="noreferrer"
              className={`${sharedStyles.btnSecondary} ${styles.inlineButton}`}
            >
              {t('setup.openAnki')}
            </a>
          )}
          <button
            type="button"
            className={`${sharedStyles.btnPrimary} ${styles.inlineButton}`}
            onClick={() => verifySignIn.mutate()}
            disabled={verifySignIn.isPending}
          >
            {verifySignIn.isPending ? t('setup.checking') : t('setup.signedIn')}
          </button>
        </div>
        {verifySignIn.isSuccess && verifyStatus !== 'linked' && (
          <div
            role="alert"
            className={`${sharedStyles.alertDanger} ${styles.signInAlert}`}
          >
            {verifyStatus === 'unreachable' ? (
              t('setup.cantReach')
            ) : (
              <>
                {t('setup.notSignedInBefore')}
                <strong>Sync</strong>
                {t('setup.notSignedInAfter')}
              </>
            )}
          </div>
        )}
        {verifySignIn.isError && (
          <div
            role="alert"
            className={`${sharedStyles.alertDanger} ${styles.signInAlert}`}
          >
            {t('setup.checkError')}
          </div>
        )}
        {!verifySignIn.isSuccess && !verifySignIn.isError && (
          <p className={styles.setupActiveStepHint} aria-live="polite">
            {t('setup.moveOnAuto')}
          </p>
        )}
        <p className={styles.setupActiveStepHint}>
          {t('setup.stuck')}
          <button
            type="button"
            className={styles.btnLink}
            onClick={() => respin.mutate()}
            disabled={respin.isPending}
          >
            {respin.isPending ? t('setup.restarting') : t('setup.restartAnki')}
          </button>
        </p>
        {respin.error && (
          <div
            role="alert"
            className={`${sharedStyles.alertDanger} ${styles.signInAlert}`}
          >
            {t('setup.restartAnkiError')}
          </div>
        )}
      </section>
    );
  };

  let activeStep: ReactNode;
  let nextPreview: ReactNode | null = null;

  if (!hasActiveClient) {
    activeStep = renderStartAnkiStep();
    nextPreview = <p>{t('setup.signInNext')}</p>;
  } else if (containerReady) {
    activeStep = renderSignInStep(activeClient);
  } else {
    activeStep = renderStartingStep();
    nextPreview = <p>{t('setup.signInNext')}</p>;
  }

  return (
    <main className={styles.setupTakeover}>
      <header className={styles.setupTakeoverHeading}>
        <h1 className={styles.setupTakeoverTitle}>
          {t('setup.takeoverTitle')}
        </h1>
        <p className={styles.setupTakeoverSubtitle}>
          {t('setup.takeoverSubtitle')}
        </p>
      </header>
      {activeStep}
      {nextPreview != null && (
        <div className={styles.setupNextPreview}>{nextPreview}</div>
      )}
    </main>
  );
}
