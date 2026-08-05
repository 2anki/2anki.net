import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';

import useUploads from './hooks/useUploads';
import useJobs from './hooks/useJobs';
import useDropboxUploads from './hooks/useDropboxUploads';
import useGoogleDriveUploads from './hooks/useGoogleDriveUploads';
import { SkeletonList } from '../../components/Skeleton/Skeleton';
import { EmptyDownloadsSection } from './components/EmptyDownloadsSection';
import { redirectOnError } from '../../components/shared/redirectOnError';
import { PaywallBanner } from './components/PaywallBanner';
import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { toDeckRows, DeckRow } from './helpers/toDeckRows';
import { getDistance } from '../../lib/getDistance';
import DownloadIcon from '../../components/icons/DownloadIcon';
import EyeIcon from '../../components/icons/EyeIcon';
import TrashIcon from '../../components/icons/TrashIcon';
import { StatusTag, JobStatus } from './components/ListJobs/StatusTag';
import { StepIndicator } from '../../components/StepIndicator/StepIndicator';
import { jobStepFromStatus } from '../../components/StepIndicator/jobStepFromStatus';
import SendToAnkifyButton from './components/SendToAnkifyButton';
import {
  DeckFeedbackPrompt,
  isDeckFeedbackSuppressed,
} from './components/DeckFeedbackPrompt';
import { useActiveShares } from './hooks/useActiveShares';
import { fireAnalyticsEvent } from '../../lib/analytics/fireAnalyticsEvent';
import { track } from '../../lib/analytics/track';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { isPayingUser } from '../../components/NavigationBar/helpers/getPlanLabel';
import { UpsellCard } from '../../components/UpsellCard';
import JobResponse from '../../schemas/public/JobResponse';
import { NotionColumnMappingModal } from '../../components/NotionColumnMappingModal/NotionColumnMappingModal';
import {
  parseAmbiguousColumnsPayload,
  type FieldMapping,
} from '../../lib/fieldMapping/types';
import { ConversionResult } from './components/ConversionResult/ConversionResult';
import { TruncationNotice } from './components/TruncationNotice';
import { parseTruncationPayload } from './helpers/parseTruncationPayload';
import { ImageDropNotice } from './components/ImageDropNotice';
import { ProducerPrompt } from './components/ProducerPrompt';
import { parseDroppedAssetsPayload } from './helpers/parseDroppedAssetsPayload';
import { ColumnsGuessedNotice } from './components/ColumnsGuessedNotice';
import { StructureRescuedNotice } from './components/StructureRescuedNotice';
import { parseStructureRescuedPayload } from './helpers/parseStructureRescuedPayload';
import { parseColumnsGuessedPayload } from './helpers/parseColumnsGuessedPayload';
import { UnsupportedBlocksNotice } from './components/UnsupportedBlocksNotice';
import { parseUnsupportedBlocksPayload } from './helpers/parseUnsupportedBlocksPayload';
import { ForbiddenBlocksNotice } from './components/ForbiddenBlocksNotice';
import { ConversionNoteToggle } from './components/ConversionNoteToggle';
import { countUnsupportedBlocks } from './helpers/countUnsupportedBlocks';
import { parseForbiddenBlocksPayload } from './helpers/parseForbiddenBlocksPayload';
import { parseMonthlyLimitPayload } from './components/ConversionResult/parseMonthlyLimitPayload';
import { MonthlyLimitPartialNotice } from './components/MonthlyLimitPartialNotice';
import { parseMonthlyLimitPartialPayload } from './helpers/parseMonthlyLimitPartialPayload';
import styles from './DownloadsPage.module.css';
import sharedStyles from '../../styles/shared.module.css';

interface DownloadsPageProps {
  setError: ErrorHandlerType;
}

type FilterValue =
  | 'all'
  | 'ready'
  | 'in-progress'
  | 'failed'
  | 'dropbox'
  | 'drive';

const VALID_FILTERS = new Set<FilterValue>([
  'all',
  'ready',
  'in-progress',
  'failed',
  'dropbox',
  'drive',
]);
const APKG_PATTERN = /\.apkg$/i;
const EMPTY_DECK_REASON_PREFIX = 'No cards in this deck yet.';
const ACTIVE_STATUSES = new Set(['done', 'failed', 'cancelled', 'interrupted']);

function isEmptyDeckReason(reason: string | null): boolean {
  return reason != null && reason.startsWith(EMPTY_DECK_REASON_PREFIX);
}

function isActiveJob(status: string): boolean {
  return !ACTIVE_STATUSES.has(status);
}

function isFailedJob(status: string): boolean {
  return ['failed', 'cancelled', 'interrupted'].includes(status);
}

function isDoneJob(status: string): boolean {
  return status === 'done';
}

function isGeneratingStatus(status: string): boolean {
  return (
    status === 'step2_creating_flashcards' ||
    /^claude:chunk:\d+:\d+$/.test(status)
  );
}

function getSourceLabel(source: DeckRow['source'], t: TFunction): string {
  switch (source) {
    case 'notion':
      return t('downloads.source.notion');
    case 'upload':
      return t('downloads.source.upload');
    case 'mcp':
      return t('downloads.source.mcp');
    case 'app':
      return t('downloads.source.app');
    case 'dropbox':
      return t('downloads.source.dropbox');
    case 'drive':
      return t('downloads.source.drive');
  }
}

function applyFilter(rows: DeckRow[], filter: FilterValue): DeckRow[] {
  switch (filter) {
    case 'all':
      return rows;
    case 'ready':
      return rows.filter((r) => {
        if (r.kind === 'job') return isDoneJob(r.job.status);
        return true;
      });
    case 'in-progress':
      return rows.filter((r) => r.kind === 'job' && isActiveJob(r.job.status));
    case 'failed':
      return rows.filter((r) => r.kind === 'job' && isFailedJob(r.job.status));
    case 'dropbox':
      return rows.filter((r) => r.source === 'dropbox');
    case 'drive':
      return rows.filter((r) => r.source === 'drive');
  }
}

interface RenderJobStatusOptions {
  job: JobResponse;
  isExpanded: boolean;
  onToggle: () => void;
}

export function renderJobStatusCell(
  j: JobResponse,
  t: TFunction,
  onDownload?: () => void
) {
  if (isDoneJob(j.status)) {
    if (j.type === 'apkg_import') {
      let notionUrl: string | null = null;
      try {
        const parsed = JSON.parse(j.job_reason_failure ?? '');
        notionUrl = parsed.notion_page_url ?? null;
      } catch {
        /* not JSON */
      }
      return notionUrl == null ? (
        <span>{t('downloads.done')}</span>
      ) : (
        <a
          href={notionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.downloadButton}
        >
          {t('downloads.openInNotion')}
        </a>
      );
    }
    if (j.download_key != null) {
      return (
        <a
          href={`/api/download/u/${j.download_key}`}
          className={styles.downloadAction}
          aria-label={t('downloads.actions.downloadNamed', {
            name: j.title ?? 'deck',
          })}
          title={t('downloads.actions.download')}
          onClick={() => {
            onDownload?.();
            fireAnalyticsEvent('deck_downloaded');
            track('deck_downloaded');
          }}
        >
          <DownloadIcon width={16} height={16} />
        </a>
      );
    }
    return null;
  }
  if (isFailedJob(j.status)) {
    return <StatusTag status={j.status as JobStatus} />;
  }
  if (j.status === 'stale') {
    return <StatusTag status={j.status as JobStatus} />;
  }
  const { step, substep } = jobStepFromStatus(j.status);
  return <StepIndicator currentStep={step} substep={substep} compact />;
}

function getFailureToggleLabel(
  isMonthlyLimit: boolean,
  isExpanded: boolean,
  t: TFunction
): string {
  if (isMonthlyLimit) {
    return isExpanded
      ? t('downloads.toggle.collapseLimit')
      : t('downloads.toggle.showLimit');
  }
  return isExpanded
    ? t('downloads.toggle.collapseFailure')
    : t('downloads.toggle.showFailure');
}

function renderJobStatusWithToggle(
  { job, isExpanded, onToggle }: RenderJobStatusOptions,
  t: TFunction
) {
  if (isFailedJob(job.status)) {
    if (isEmptyDeckReason(job.job_reason_failure)) {
      return <StatusTag status={job.status as JobStatus} />;
    }
    const isMonthlyLimit =
      parseMonthlyLimitPayload(job.job_reason_failure) != null;
    return (
      <button
        type="button"
        className={styles.statusToggle}
        onClick={onToggle}
        aria-label={getFailureToggleLabel(isMonthlyLimit, isExpanded, t)}
        aria-expanded={isExpanded}
      >
        {isMonthlyLimit ? (
          <span className={sharedStyles.badge}>
            {t('downloads.badge.monthlyLimitReached')}
          </span>
        ) : (
          <StatusTag status={job.status as JobStatus} />
        )}
        <span
          className={`${styles.statusChevron} ${isExpanded ? styles.statusChevronExpanded : ''}`}
        >
          ▾
        </span>
      </button>
    );
  }
  return renderJobStatusCell(job, t);
}

const NOTION_TOKEN_EXPIRED_REASON = 'notion_token_expired';

function isNotionTokenExpired(
  source: DeckRow['source'],
  reason: string | null
): boolean {
  return source === 'notion' && reason === NOTION_TOKEN_EXPIRED_REASON;
}

function renderFailurePanelContent(
  source: DeckRow['source'],
  reason: string,
  onMapColumns: () => void
): ReactNode {
  const monthlyLimit = parseMonthlyLimitPayload(reason);
  if (monthlyLimit != null) {
    return (
      <ConversionResult
        variant="paywalled"
        title={null}
        limit={monthlyLimit.limit}
        cardsUsed={monthlyLimit.cards_used}
        resetOn={monthlyLimit.reset_on}
      />
    );
  }
  return (
    <ConversionResult
      variant="failed"
      title={null}
      failureReason={reason}
      source={source === 'notion' ? 'notion' : 'upload'}
      onMapColumns={onMapColumns}
    />
  );
}

function formatUpdatedLabel(lastFetchedAt: Date | null, t: TFunction): string {
  if (lastFetchedAt == null) return '';
  return t('downloads.updatedRelative', {
    time: getDistance(lastFetchedAt),
  });
}

function FilterChip({
  label,
  value,
  active,
  onSelect,
}: {
  label: string;
  value: FilterValue;
  active: boolean;
  onSelect: (v: FilterValue) => void;
}) {
  return (
    <button
      type="button"
      className={
        active
          ? `${sharedStyles.chip} ${sharedStyles.chipActive}`
          : sharedStyles.chip
      }
      onClick={() => onSelect(value)}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

export function DownloadsPage({ setError }: Readonly<DownloadsPageProps>) {
  const { t } = useTranslation();
  const backend = get2ankiApi();
  const { deleteUpload, loading, uploads, error, refreshUploads } =
    useUploads(backend);
  const { jobs, deleteJob, restartJob, refreshJobs, lastFetchedAt } = useJobs(
    backend,
    setError
  );
  const { uploads: dropboxUploads, deleteUpload: deleteDropboxUpload } =
    useDropboxUploads(backend);
  const { uploads: googleDriveUploads, deleteUpload: deleteGoogleDriveUpload } =
    useGoogleDriveUploads(backend);
  const { data } = useUserLocals();
  const showUpgradeFooter = !isPayingUser(data?.locals);
  const activeShares = useActiveShares();
  const sharedKeySet = new Set(activeShares.map((s) => s.upload_key));

  const [searchParams, setSearchParams] = useSearchParams();
  const showPaywall = searchParams.get('paywall') === '1';
  const [showVerifiedBanner, setShowVerifiedBanner] = useState(
    searchParams.get('verified') === '1'
  );
  const [expandedFailureJobId, setExpandedFailureJobId] = useState<
    number | string | null
  >(null);
  const [limitPanelCollapsed, setLimitPanelCollapsed] = useState(false);
  const [mappingModalJob, setMappingModalJob] = useState<JobResponse | null>(
    null
  );
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const pageViewTracked = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (pageViewTracked.current) return;
    pageViewTracked.current = true;
    track('downloads_page_viewed');
  }, []);

  const rawFilter = searchParams.get('filter') ?? 'all';
  const activeFilter: FilterValue = VALID_FILTERS.has(rawFilter as FilterValue)
    ? (rawFilter as FilterValue)
    : 'all';

  useEffect(() => {
    if (searchParams.get('verified') !== '1') return;
    const params = new URLSearchParams(searchParams);
    params.delete('verified');
    setSearchParams(params, { replace: true });
    const timer = setTimeout(() => setShowVerifiedBanner(false), 6000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const failedJobs = jobs.filter((j) => isFailedJob(j.status));
    if (failedJobs.length === 0) return;

    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

    const recentFailedJob = failedJobs
      .filter((j) => {
        if (j.last_edited_time == null) return false;
        const lastEditedDate = new Date(j.last_edited_time);
        return lastEditedDate >= tenMinutesAgo;
      })
      .sort((a, b) => {
        const dateA = new Date(a.last_edited_time!).getTime();
        const dateB = new Date(b.last_edited_time!).getTime();
        return dateB - dateA;
      })[0];

    if (recentFailedJob != null) {
      setExpandedFailureJobId(recentFailedJob.id);
    }
  }, [jobs]);

  useEffect(() => {
    if (limitPanelCollapsed) return;
    const limitJob = jobs.find(
      (j) =>
        isFailedJob(j.status) &&
        parseMonthlyLimitPayload(j.job_reason_failure) != null
    );
    if (limitJob == null) return;
    setExpandedFailureJobId((current) => current ?? limitJob.id);
  }, [jobs, limitPanelCollapsed]);

  const setFilter = (value: FilterValue) => {
    const params = new URLSearchParams(searchParams);
    if (value === 'all') {
      params.delete('filter');
    } else {
      params.set('filter', value);
    }
    setSearchParams(params, { replace: true });
  };

  const handleMappingSubmit = useCallback(
    async (mapping: FieldMapping) => {
      if (mappingModalJob == null) return;
      setMappingModalJob(null);
      await backend.convert(
        mappingModalJob.object_id,
        mappingModalJob.type,
        mappingModalJob.title,
        mapping
      );
      track('notion_column_mapping_submitted');
      await refreshJobs();
    },
    [mappingModalJob, backend, refreshJobs]
  );

  const activeJobs = jobs.filter((j) => isActiveJob(j.status));
  const showDeckFeedback = hasDownloaded && !isDeckFeedbackSuppressed();

  const handleDeleteJob = async (id: Parameters<typeof deleteJob>[0]) => {
    const job = jobs.find((j) => j.id === id);
    if (job != null && isGeneratingStatus(job.status)) {
      track('cancel_during_generating');
    }
    await deleteJob(id);
    await refreshUploads();
  };

  const handleDeleteUpload = async (key: string) => {
    await deleteUpload(key);
    await refreshJobs();
  };

  if (error) {
    redirectOnError(error);
    return null;
  }

  const allRows = toDeckRows(
    jobs,
    uploads ?? [],
    dropboxUploads,
    googleDriveUploads
  );
  const filteredRows = applyFilter(allRows, activeFilter);

  const totalCount = allRows.length;
  const hasActiveJobs = activeJobs.length > 0;
  const isGloballyEmpty = totalCount === 0 && !hasActiveJobs;

  return (
    <div className={sharedStyles.page}>
      {showVerifiedBanner && (
        <div
          className={sharedStyles.alertSuccess}
          role="status"
          aria-live="polite"
        >
          {t('downloads.emailVerified')}
        </div>
      )}
      <div className={sharedStyles.pageHeader}>
        <h1 className={sharedStyles.title}>{t('downloads.title')}</h1>
        <p className={sharedStyles.subtitle}>{t('downloads.subtitle')}</p>
      </div>

      {loading ? (
        <SkeletonList count={4} />
      ) : (
        <>
          {showPaywall && (
            <PaywallBanner inProgressJob={activeJobs[0] ?? null} />
          )}

          <EmptyDownloadsSection
            isEmpty={isGloballyEmpty && activeFilter === 'all'}
          />

          {(!isGloballyEmpty || activeFilter !== 'all') && (
            <div className={styles.section}>
              <div
                className={sharedStyles.flexWrap}
                style={{ marginBottom: '1rem' }}
              >
                <FilterChip
                  label={t('downloads.filters.all')}
                  value="all"
                  active={activeFilter === 'all'}
                  onSelect={setFilter}
                />
                <FilterChip
                  label={t('downloads.filters.ready')}
                  value="ready"
                  active={activeFilter === 'ready'}
                  onSelect={setFilter}
                />
                <FilterChip
                  label={t('downloads.filters.inProgress')}
                  value="in-progress"
                  active={activeFilter === 'in-progress'}
                  onSelect={setFilter}
                />
                <FilterChip
                  label={t('downloads.filters.failed')}
                  value="failed"
                  active={activeFilter === 'failed'}
                  onSelect={setFilter}
                />
                <FilterChip
                  label={t('downloads.filters.fromDropbox')}
                  value="dropbox"
                  active={activeFilter === 'dropbox'}
                  onSelect={setFilter}
                />
                <FilterChip
                  label={t('downloads.filters.fromDrive')}
                  value="drive"
                  active={activeFilter === 'drive'}
                  onSelect={setFilter}
                />
              </div>

              <div className={styles.card}>
                <div style={{ overflowX: 'auto' }}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>{t('downloads.columns.name')}</th>
                        <th>{t('downloads.columns.source')}</th>
                        <th>{t('downloads.columns.created')}</th>
                        <th className={sharedStyles.actionColumnWide}>
                          {t('downloads.columns.actions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody translate="no">
                      {filteredRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            style={{
                              textAlign: 'center',
                              color: 'var(--color-text-secondary)',
                              padding: '2rem 1rem',
                            }}
                          >
                            {t('downloads.noMatch')}
                          </td>
                        </tr>
                      )}
                      {filteredRows.map((row) => {
                        if (row.kind === 'job') {
                          const isExpanded =
                            expandedFailureJobId === row.job.id;
                          const isFailed = isFailedJob(row.job.status);
                          const truncation = parseTruncationPayload(row.job);
                          const droppedAssets = parseDroppedAssetsPayload(
                            row.job
                          );
                          const guessedColumns = parseColumnsGuessedPayload(
                            row.job
                          );
                          const structureRescued = parseStructureRescuedPayload(
                            row.job
                          );
                          const unsupportedBlocks =
                            parseUnsupportedBlocksPayload(row.job);
                          const forbiddenBlocks = parseForbiddenBlocksPayload(
                            row.job
                          );
                          const cardLimitPartial =
                            parseMonthlyLimitPartialPayload(row.job);
                          const isMonthlyLimitRow =
                            isFailed &&
                            parseMonthlyLimitPayload(
                              row.job.job_reason_failure
                            ) != null;
                          const toggleFailurePanel = () => {
                            if (isMonthlyLimitRow && isExpanded) {
                              setLimitPanelCollapsed(true);
                            }
                            setExpandedFailureJobId(
                              isExpanded ? null : row.job.id
                            );
                          };

                          return (
                            <>
                              <tr
                                key={`job-${row.job.id}`}
                                className={isFailed ? styles.failedRow : ''}
                              >
                                <td>
                                  <span
                                    data-hj-suppress
                                    className={styles.fileName}
                                  >
                                    {row.job.title ?? '—'}
                                  </span>
                                </td>
                                <td>
                                  <span className={sharedStyles.badge}>
                                    {row.source === 'upload' &&
                                    row.job.type === 'claude'
                                      ? t('downloads.badge.writtenWithClaude')
                                      : getSourceLabel(row.source, t)}
                                  </span>
                                </td>
                                <td>
                                  {row.job.created_at != null && (
                                    <span className={styles.timeAgo}>
                                      {getDistance(row.job.created_at)}
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <div className={styles.actions}>
                                    {isFailed ? (
                                      renderJobStatusWithToggle(
                                        {
                                          job: row.job,
                                          isExpanded,
                                          onToggle: toggleFailurePanel,
                                        },
                                        t
                                      )
                                    ) : (
                                      <>
                                        {renderJobStatusCell(row.job, t, () =>
                                          setHasDownloaded(true)
                                        )}
                                        {truncation != null && (
                                          <button
                                            type="button"
                                            className={styles.statusToggle}
                                            onClick={toggleFailurePanel}
                                            aria-label={
                                              isExpanded
                                                ? t(
                                                    'downloads.toggle.collapseNote'
                                                  )
                                                : t('downloads.toggle.showNote')
                                            }
                                            aria-expanded={isExpanded}
                                          >
                                            <span
                                              className={sharedStyles.badge}
                                            >
                                              {t('downloads.badge.partial')}
                                            </span>
                                            <span
                                              className={`${styles.statusChevron} ${isExpanded ? styles.statusChevronExpanded : ''}`}
                                            >
                                              ▾
                                            </span>
                                          </button>
                                        )}
                                        {droppedAssets != null && (
                                          <button
                                            type="button"
                                            className={styles.statusToggle}
                                            onClick={toggleFailurePanel}
                                            aria-label={
                                              isExpanded
                                                ? t(
                                                    'downloads.toggle.collapseImageNote'
                                                  )
                                                : t(
                                                    'downloads.toggle.showImageNote'
                                                  )
                                            }
                                            aria-expanded={isExpanded}
                                          >
                                            <span
                                              className={
                                                sharedStyles.badgeWarning
                                              }
                                            >
                                              {t(
                                                'downloads.badge.imageSkipped',
                                                {
                                                  count: droppedAssets,
                                                }
                                              )}
                                            </span>
                                            <span
                                              className={`${styles.statusChevron} ${isExpanded ? styles.statusChevronExpanded : ''}`}
                                            >
                                              ▾
                                            </span>
                                          </button>
                                        )}
                                        {cardLimitPartial != null && (
                                          <button
                                            type="button"
                                            className={styles.statusToggle}
                                            onClick={toggleFailurePanel}
                                            aria-label={
                                              isExpanded
                                                ? t(
                                                    'downloads.toggle.collapseNote'
                                                  )
                                                : t('downloads.toggle.showNote')
                                            }
                                            aria-expanded={isExpanded}
                                          >
                                            <span
                                              className={sharedStyles.badge}
                                            >
                                              {t('downloads.badge.partial')}
                                            </span>
                                            <span
                                              className={`${styles.statusChevron} ${isExpanded ? styles.statusChevronExpanded : ''}`}
                                            >
                                              ▾
                                            </span>
                                          </button>
                                        )}
                                        {forbiddenBlocks != null && (
                                          <ConversionNoteToggle
                                            badge={t(
                                              'downloads.badge.blocksForbidden',
                                              { count: forbiddenBlocks.count }
                                            )}
                                            controlsId={`job-${row.job.id}-forbiddenblocks`}
                                            tone="warning"
                                            isExpanded={isExpanded}
                                            onToggle={toggleFailurePanel}
                                          />
                                        )}
                                        {unsupportedBlocks != null && (
                                          <ConversionNoteToggle
                                            badge={t(
                                              'downloads.badge.blocksSkipped',
                                              {
                                                count:
                                                  countUnsupportedBlocks(
                                                    unsupportedBlocks
                                                  ),
                                              }
                                            )}
                                            controlsId={`job-${row.job.id}-unsupportedblocks`}
                                            tone="warning"
                                            isExpanded={isExpanded}
                                            onToggle={toggleFailurePanel}
                                          />
                                        )}
                                        {structureRescued != null && (
                                          <ConversionNoteToggle
                                            badge={t(
                                              'downloads.badge.structureGuessed'
                                            )}
                                            controlsId={`job-${row.job.id}-structurerescued`}
                                            tone="neutral"
                                            isExpanded={isExpanded}
                                            onToggle={toggleFailurePanel}
                                          />
                                        )}
                                        {guessedColumns != null && (
                                          <ConversionNoteToggle
                                            badge={t(
                                              'downloads.badge.columnsGuessed'
                                            )}
                                            controlsId={`job-${row.job.id}-columnsguess`}
                                            tone="neutral"
                                            isExpanded={isExpanded}
                                            onToggle={toggleFailurePanel}
                                          />
                                        )}
                                      </>
                                    )}
                                    <div className={styles.secondaryActions}>
                                      {isDoneJob(row.job.status) &&
                                        row.job.download_key != null &&
                                        APKG_PATTERN.test(
                                          row.job.download_key
                                        ) && (
                                          <Link
                                            to={`/preview/apkg/${encodeURIComponent(row.job.download_key)}`}
                                            className={styles.iconButton}
                                            aria-label={t(
                                              'downloads.actions.previewNamed',
                                              { name: row.job.title ?? 'deck' }
                                            )}
                                            title={t(
                                              'downloads.actions.preview'
                                            )}
                                          >
                                            <EyeIcon width={16} height={16} />
                                          </Link>
                                        )}
                                      {(row.source === 'notion' ||
                                        row.source === 'mcp') &&
                                        isDoneJob(row.job.status) &&
                                        row.job.upload_id != null && (
                                          <SendToAnkifyButton
                                            uploadId={row.job.upload_id}
                                            filename={row.job.title}
                                          />
                                        )}
                                      {isFailed &&
                                        row.job.restartable &&
                                        !isNotionTokenExpired(
                                          row.source,
                                          row.job.job_reason_failure
                                        ) && (
                                          <button
                                            type="button"
                                            onClick={() => restartJob(row.job)}
                                            className={styles.iconButton}
                                            aria-label={t(
                                              'downloads.actions.restartJob'
                                            )}
                                            title={t(
                                              'downloads.actions.restart'
                                            )}
                                          >
                                            ↺
                                          </button>
                                        )}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleDeleteJob(row.job.id)
                                        }
                                        className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                                        aria-label={
                                          isFailed || isDoneJob(row.job.status)
                                            ? t(
                                                'downloads.actions.deleteNamed',
                                                {
                                                  name: row.job.title,
                                                }
                                              )
                                            : t(
                                                'downloads.actions.cancelNamed',
                                                {
                                                  name: row.job.title,
                                                }
                                              )
                                        }
                                        title={
                                          isFailed
                                            ? t('downloads.actions.delete')
                                            : t('downloads.actions.cancel')
                                        }
                                      >
                                        <TrashIcon width={16} height={16} />
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                              {isFailed &&
                                (isExpanded ||
                                  isEmptyDeckReason(
                                    row.job.job_reason_failure
                                  )) &&
                                row.job.job_reason_failure != null && (
                                  <tr key={`job-${row.job.id}-panel`}>
                                    <td
                                      colSpan={4}
                                      className={styles.failurePanel}
                                    >
                                      {renderFailurePanelContent(
                                        row.source,
                                        row.job.job_reason_failure,
                                        () => setMappingModalJob(row.job)
                                      )}
                                    </td>
                                  </tr>
                                )}
                              {!isFailed &&
                                isExpanded &&
                                truncation != null && (
                                  <tr key={`job-${row.job.id}-truncation`}>
                                    <td
                                      colSpan={4}
                                      className={styles.failurePanel}
                                    >
                                      <TruncationNotice
                                        blocksConverted={
                                          truncation.blocksConverted
                                        }
                                        subDeckRulesSkipped={
                                          truncation.subDeckRulesSkipped
                                        }
                                      />
                                    </td>
                                  </tr>
                                )}
                              {!isFailed &&
                                isExpanded &&
                                droppedAssets != null && (
                                  <tr key={`job-${row.job.id}-imagedrop`}>
                                    <td
                                      colSpan={4}
                                      className={styles.failurePanel}
                                    >
                                      <ImageDropNotice count={droppedAssets} />
                                    </td>
                                  </tr>
                                )}
                              {!isFailed &&
                                isExpanded &&
                                guessedColumns != null && (
                                  <tr key={`job-${row.job.id}-columnsguess`}>
                                    <td
                                      colSpan={4}
                                      className={styles.failurePanel}
                                      id={`job-${row.job.id}-columnsguess`}
                                    >
                                      <ColumnsGuessedNotice
                                        frontField={guessedColumns.frontField}
                                        backField={guessedColumns.backField}
                                      />
                                    </td>
                                  </tr>
                                )}
                              {!isFailed &&
                                isExpanded &&
                                structureRescued != null && (
                                  <tr
                                    key={`job-${row.job.id}-structurerescued`}
                                  >
                                    <td
                                      colSpan={4}
                                      className={styles.failurePanel}
                                      id={`job-${row.job.id}-structurerescued`}
                                    >
                                      <StructureRescuedNotice
                                        rule={structureRescued.rule}
                                      />
                                    </td>
                                  </tr>
                                )}
                              {!isFailed &&
                                isExpanded &&
                                forbiddenBlocks != null && (
                                  <tr key={`job-${row.job.id}-forbiddenblocks`}>
                                    <td
                                      colSpan={4}
                                      className={styles.failurePanel}
                                      id={`job-${row.job.id}-forbiddenblocks`}
                                    >
                                      <ForbiddenBlocksNotice
                                        count={forbiddenBlocks.count}
                                      />
                                    </td>
                                  </tr>
                                )}
                              {!isFailed &&
                                isExpanded &&
                                unsupportedBlocks != null && (
                                  <tr
                                    key={`job-${row.job.id}-unsupportedblocks`}
                                  >
                                    <td
                                      colSpan={4}
                                      className={styles.failurePanel}
                                      id={`job-${row.job.id}-unsupportedblocks`}
                                    >
                                      <UnsupportedBlocksNotice
                                        counts={unsupportedBlocks}
                                      />
                                    </td>
                                  </tr>
                                )}
                              {!isFailed &&
                                isExpanded &&
                                cardLimitPartial != null && (
                                  <tr key={`job-${row.job.id}-cardlimit`}>
                                    <td
                                      colSpan={4}
                                      className={styles.failurePanel}
                                    >
                                      <MonthlyLimitPartialNotice
                                        cardsDelivered={
                                          cardLimitPartial.cardsDelivered
                                        }
                                        cardsHeldBack={
                                          cardLimitPartial.cardsHeldBack
                                        }
                                        limit={cardLimitPartial.limit}
                                      />
                                    </td>
                                  </tr>
                                )}
                            </>
                          );
                        }

                        if (row.kind === 'file') {
                          const u = row.upload;
                          const isShared = sharedKeySet.has(u.key);
                          const sharePreviewUrl = `/preview/apkg/${encodeURIComponent(u.key)}`;
                          return (
                            <tr key={`upload-${u.key}`}>
                              <td>
                                <span
                                  data-hj-suppress
                                  className={styles.fileName}
                                >
                                  {u.filename}
                                </span>
                                {isShared && (
                                  <Link
                                    to={sharePreviewUrl}
                                    className={sharedStyles.badge}
                                    style={{
                                      marginLeft: '0.5rem',
                                      textDecoration: 'none',
                                    }}
                                    title="Shared — click to open preview"
                                  >
                                    {t('downloads.badge.shared')}
                                  </Link>
                                )}
                              </td>
                              <td>
                                <span className={sharedStyles.badge}>
                                  {getSourceLabel(row.source, t)}
                                </span>
                              </td>
                              <td>
                                {u.created_at != null && (
                                  <span className={styles.timeAgo}>
                                    {getDistance(u.created_at)}
                                  </span>
                                )}
                              </td>
                              <td>
                                <div className={styles.actions}>
                                  <a
                                    href={`/api/download/u/${u.key}`}
                                    className={styles.downloadAction}
                                    aria-label={t(
                                      'downloads.actions.downloadNamed',
                                      { name: u.filename }
                                    )}
                                    title={t('downloads.actions.download')}
                                    onClick={() => {
                                      setHasDownloaded(true);
                                      fireAnalyticsEvent('deck_downloaded');
                                      track('deck_downloaded');
                                    }}
                                  >
                                    <DownloadIcon width={16} height={16} />
                                  </a>
                                  <div className={styles.secondaryActions}>
                                    {APKG_PATTERN.test(u.key) && (
                                      <Link
                                        to={`/preview/apkg/${encodeURIComponent(u.key)}`}
                                        className={styles.iconButton}
                                        aria-label={t(
                                          'downloads.actions.previewNamed',
                                          { name: u.filename }
                                        )}
                                        title={t('downloads.actions.preview')}
                                      >
                                        <EyeIcon width={16} height={16} />
                                      </Link>
                                    )}
                                    {APKG_PATTERN.test(u.key) && (
                                      <SendToAnkifyButton
                                        uploadId={u.id}
                                        filename={u.filename}
                                      />
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteUpload(u.key)}
                                      className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                                      aria-label={t(
                                        'downloads.actions.deleteNamed',
                                        { name: u.filename }
                                      )}
                                      title={t('downloads.actions.delete')}
                                    >
                                      <TrashIcon width={16} height={16} />
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        if (row.kind === 'dropbox') {
                          const d = row.upload;
                          return (
                            <tr key={`dropbox-${d.id}`}>
                              <td>
                                <span
                                  data-hj-suppress
                                  className={styles.fileName}
                                  title={d.name}
                                >
                                  {d.name.length > 40
                                    ? `${d.name.slice(0, 40)}…`
                                    : d.name}
                                </span>
                              </td>
                              <td>
                                <span className={sharedStyles.badge}>
                                  {t('downloads.source.dropbox')}
                                </span>
                              </td>
                              <td>
                                {d.created_at != null && (
                                  <span className={styles.timeAgo}>
                                    {getDistance(d.created_at)}
                                  </span>
                                )}
                              </td>
                              <td>
                                <div className={styles.actions}>
                                  <div className={styles.secondaryActions}>
                                    <button
                                      type="button"
                                      className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                                      onClick={() => deleteDropboxUpload(d.id)}
                                      aria-label={t(
                                        'downloads.actions.removeNamed',
                                        { name: d.name }
                                      )}
                                      title={t('downloads.actions.remove')}
                                    >
                                      <TrashIcon width={16} height={16} />
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        if (row.kind === 'drive') {
                          const g = row.upload;
                          return (
                            <tr key={`drive-${g.id}`}>
                              <td>
                                <span
                                  data-hj-suppress
                                  className={styles.fileName}
                                  title={g.name}
                                >
                                  {g.name.length > 40
                                    ? `${g.name.slice(0, 40)}…`
                                    : g.name}
                                </span>
                              </td>
                              <td>
                                <span className={sharedStyles.badge}>
                                  {t('downloads.source.drive')}
                                </span>
                              </td>
                              <td>
                                {g.last_converted_at != null && (
                                  <span className={styles.timeAgo}>
                                    {getDistance(g.last_converted_at)}
                                  </span>
                                )}
                              </td>
                              <td>
                                <div className={styles.actions}>
                                  <div className={styles.secondaryActions}>
                                    <button
                                      type="button"
                                      className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                                      onClick={() =>
                                        deleteGoogleDriveUpload(g.id)
                                      }
                                      aria-label={t(
                                        'downloads.actions.removeNamed',
                                        { name: g.name }
                                      )}
                                      title={t('downloads.actions.remove')}
                                    >
                                      <TrashIcon width={16} height={16} />
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        return null;
                      })}
                    </tbody>
                  </table>
                </div>
                {showUpgradeFooter && !isGloballyEmpty && (
                  <div className={styles.upgradeFooter}>
                    <UpsellCard surface="downloads_upsell" hideForAnonymous />
                  </div>
                )}
              </div>

              {hasDownloaded && (
                <div className={styles.makeAnotherDeck}>
                  <button
                    type="button"
                    className={sharedStyles.btnSecondary}
                    onClick={() => {
                      fireAnalyticsEvent('make_another_deck_clicked');
                      track('make_another_deck_clicked');
                      navigate('/upload');
                    }}
                  >
                    {t('downloads.makeAnotherDeck')}
                  </button>
                </div>
              )}

              {showDeckFeedback && <DeckFeedbackPrompt />}

              <ProducerPrompt uploads={uploads ?? []} />

              <div
                style={{
                  textAlign: 'right',
                  marginTop: '0.5rem',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-tertiary)',
                }}
              >
                {formatUpdatedLabel(lastFetchedAt, t)}
              </div>
            </div>
          )}
        </>
      )}
      {mappingModalJob != null &&
        (() => {
          const payload = parseAmbiguousColumnsPayload(
            mappingModalJob.job_reason_failure
          );
          if (payload == null) return null;
          return (
            <NotionColumnMappingModal
              isOpen
              columns={payload.columns}
              suggested={payload.suggested}
              onSubmit={handleMappingSubmit}
              onCancel={() => setMappingModalJob(null)}
            />
          );
        })()}
    </div>
  );
}
