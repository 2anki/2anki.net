import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import sharedStyles from '../../styles/shared.module.css';
import styles from './AnkifyPage.module.css';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import AnkifyClient from '../../lib/interfaces/AnkifyClient';
import { Backend } from '../../lib/backend/Backend';
import NotionSubscriptions from './components/NotionSubscriptions';
import WorkspaceBar from './components/WorkspaceBar';
import ConflictsModal from './components/ConflictsModal';
import StudyStatsSection from './stats/StudyStatsSection';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { isForbidden } from '../../lib/backend/isForbidden';

const QUERY_KEY = ['ankify-clients'];
const ANKI_WEB_ACK_KEY = 'ankify_anki_web_acknowledged';
const TRACKER_LOCAL_KEY = 'ankify-export-database-id';
const TRACKER_TITLE_LOCAL_KEY = 'ankify-export-database-title';
const TRACKER_URL_LOCAL_KEY = 'ankify-export-database-url';

const readLocal = (key: string): string => {
  try {
    return globalThis.localStorage?.getItem(key) ?? '';
  } catch {
    return '';
  }
};

const readSignedInAcknowledged = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(ANKI_WEB_ACK_KEY) === 'true';
  } catch {
    return false;
  }
};

interface AnkifyPageProps {
  backend?: Backend;
}

export default function AnkifyPage({ backend }: Readonly<AnkifyPageProps>) {
  const { t } = useTranslation('ankify');
  const api = backend ?? get2ankiApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const { data: userLocals } = useUserLocals();
  const welcomeSeen = userLocals?.user?.ankify_welcome_seen === true;
  const [dismissed, setDismissed] = useState(false);
  const [ankifyTab, setAnkifyTab] = useState<
    'decks' | 'find' | 'leeches' | 'review'
  >('decks');

  const dismissWelcome = () => {
    setDismissed(true);
    api
      .markAnkifyWelcomeSeen()
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['userLocals'] });
      })
      .catch(() => {});
  };

  const { data, isLoading } = useQuery<AnkifyClient[]>({
    queryKey: QUERY_KEY,
    queryFn: () => api.listAnkifyClients(),
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 3,
  });

  const conflicts = useQuery({
    queryKey: ['ankify-conflicts'],
    queryFn: () => api.listAnkifyConflicts(),
    refetchInterval: 30_000,
  });

  const exportSchedule = useQuery({
    queryKey: ['ankify-export-schedule'],
    queryFn: () => api.getAnkifyExportSchedule(),
  });

  const hasActiveClient = data?.some((c) => c.status === 'active') ?? false;
  const signedInAcknowledged = readSignedInAcknowledged();

  useEffect(() => {
    if (!isLoading && (!hasActiveClient || !signedInAcknowledged)) {
      navigate('/ankify/setup', { replace: true });
    }
  }, [isLoading, hasActiveClient, signedInAcknowledged, navigate]);

  if (isLoading || !hasActiveClient || !signedInAcknowledged) {
    return (
      <main className={sharedStyles.page}>
        <p className={styles.emptyLine}>{t('page.loadingWorkspace')}</p>
      </main>
    );
  }

  const conflictCount = conflicts.data?.length ?? 0;
  const trackerId = readLocal(TRACKER_LOCAL_KEY);
  const trackerTitle = readLocal(TRACKER_TITLE_LOCAL_KEY);
  const trackerUrl = readLocal(TRACKER_URL_LOCAL_KEY);
  const hasTracker = trackerId.trim().length > 0;

  return (
    <main className={sharedStyles.page}>
      <WorkspaceBar backend={backend} title="Ankify" />

      {!welcomeSeen && !dismissed && (
        <div
          role="status"
          aria-live="polite"
          className={`${sharedStyles.alertSuccess} ${styles.welcomeBanner}`}
        >
          <span>
            {t('page.welcomePrefix')}
            <span>Ankify Basic and Ankify Cloze</span>
            {t('page.welcomeSuffix')}
          </span>
          <button
            type="button"
            className={sharedStyles.btnSecondary}
            onClick={dismissWelcome}
          >
            {t('page.gotIt')}
          </button>
        </div>
      )}

      {conflictCount > 0 && (
        <output className={styles.conflictsBanner}>
          <span>{t('page.conflictsToResolve', { count: conflictCount })}</span>
          <button
            type="button"
            className={styles.conflictsBannerLink}
            onClick={() => setConflictsOpen(true)}
          >
            {t('page.reviewConflicts')}
          </button>
        </output>
      )}

      <ConflictsModal
        open={conflictsOpen}
        onClose={() => setConflictsOpen(false)}
        backend={backend}
      />

      <NotionSubscriptions
        backend={backend}
        schedule={exportSchedule.data ?? null}
        onTabChange={setAnkifyTab}
      />

      {ankifyTab === 'decks' && (
        <>
          <div className={styles.historyFooter}>
            {hasTracker ? (
              <>
                <Link to="/ankify/history" className={styles.historyFooterLink}>
                  {t('page.studyHistory')}
                </Link>
                <span>
                  {trackerTitle.length > 0
                    ? trackerTitle
                    : t('page.reviewTrackerFallback')}
                </span>
                {trackerUrl.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <a href={trackerUrl} target="_blank" rel="noreferrer">
                      {t('page.open')}
                    </a>
                  </>
                )}
              </>
            ) : (
              <>
                <span>{t('page.historyGoesTo')}</span>
                <Link to="/ankify/history" className={styles.historyFooterLink}>
                  {t('page.setItUp')}
                </Link>
              </>
            )}
          </div>

          <StudyStatsSection backend={api} />
        </>
      )}
    </main>
  );
}
