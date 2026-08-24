import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { get2ankiApi } from '../../../../lib/backend/get2ankiApi';
import {
  ConversionReport,
  ConversionReportEntry,
} from '../../../../lib/interfaces/ConversionReport';
import { useDialog } from '../../../../lib/hooks/useDialog';
import { track } from '../../../../lib/analytics/track';
import JobResponse from '../../../../schemas/public/JobResponse';
import { TruncationNotice } from '../TruncationNotice';
import { ImageDropNotice } from '../ImageDropNotice';
import { ColumnsGuessedNotice } from '../ColumnsGuessedNotice';
import { StructureRescuedNotice } from '../StructureRescuedNotice';
import { UnsupportedBlocksNotice } from '../UnsupportedBlocksNotice';
import { ForbiddenBlocksNotice } from '../ForbiddenBlocksNotice';
import { MonthlyLimitPartialNotice } from '../MonthlyLimitPartialNotice';
import { parseTruncationPayload } from '../../helpers/parseTruncationPayload';
import { parseDroppedAssetsPayload } from '../../helpers/parseDroppedAssetsPayload';
import { parseColumnsGuessedPayload } from '../../helpers/parseColumnsGuessedPayload';
import { parseStructureRescuedPayload } from '../../helpers/parseStructureRescuedPayload';
import { parseUnsupportedBlocksPayload } from '../../helpers/parseUnsupportedBlocksPayload';
import { parseForbiddenBlocksPayload } from '../../helpers/parseForbiddenBlocksPayload';
import { parseMonthlyLimitPartialPayload } from '../../helpers/parseMonthlyLimitPartialPayload';
import { getSignalSkippedCount } from '../../helpers/getSignalSkippedCount';
import sharedStyles from '../../../../styles/shared.module.css';
import styles from './ConversionReportModal.module.css';

interface ConversionReportModalProps {
  job: JobResponse;
  onClose: () => void;
}

type ReportTone = 'note' | 'skipped' | 'failed';

const UNSUPPORTED_PREFIX = 'unsupported_block:';

function entryTone(entry: ConversionReportEntry): ReportTone {
  if (entry.reason_code === 'blocks_forbidden') {
    return 'failed';
  }
  if (entry.reason_code === 'truncated') {
    return 'note';
  }
  return 'skipped';
}

function entryCopy(t: TFunction, entry: ConversionReportEntry): string {
  const code = entry.reason_code;
  if (code === 'blocks_forbidden') {
    return t('blocksForbidden.notion', { count: entry.count });
  }
  if (code === 'assets_dropped') {
    return t('imageDrop.notion', { count: entry.count });
  }
  if (code === 'empty_back') {
    return t('report.reasonEmptyBack', { count: entry.count });
  }
  if (code === 'truncated') {
    return t('report.reasonTruncated');
  }
  if (code.startsWith(UNSUPPORTED_PREFIX)) {
    return t('report.reasonUnsupported', {
      count: entry.count,
      type: code.slice(UNSUPPORTED_PREFIX.length),
    });
  }
  return entry.human_reason;
}

function ToneBadge({ tone }: Readonly<{ tone: ReportTone }>) {
  const { t } = useTranslation('downloadsx');
  if (tone === 'failed') {
    return (
      <span className={sharedStyles.badgeDanger}>{t('report.toneFailed')}</span>
    );
  }
  if (tone === 'skipped') {
    return (
      <span className={sharedStyles.badgeWarning}>
        {t('report.toneSkipped')}
      </span>
    );
  }
  return <span className={sharedStyles.badge}>{t('report.toneNote')}</span>;
}

function ReportSummary({ report }: Readonly<{ report: ConversionReport }>) {
  const { t } = useTranslation('downloadsx');
  const skipped = report.summary.blocks_skipped;
  return (
    <p className={styles.summary}>
      {t('report.summary', {
        count: report.summary.cards_created,
        blocks: report.summary.blocks_seen,
      })}
      {' · '}
      <span className={skipped > 0 ? styles.summarySkippedWarning : undefined}>
        {t('report.skipped', { count: skipped })}
      </span>
    </p>
  );
}

function ReportEntries({ report }: Readonly<{ report: ConversionReport }>) {
  const { t } = useTranslation('downloadsx');
  if (report.entries.length === 0) {
    return <p>{t('report.clean')}</p>;
  }
  return (
    <ul className={styles.entries}>
      {report.entries.map((entry) => (
        <li
          key={`${entry.stage}-${entry.reason_code}`}
          className={styles.entry}
        >
          <ToneBadge tone={entryTone(entry)} />
          <span>{entryCopy(t, entry)}</span>
        </li>
      ))}
      {report.truncated === true && report.omitted_entry_count != null && (
        <li className={styles.entry}>
          <ToneBadge tone="note" />
          <span>
            {t('report.omitted', { count: report.omitted_entry_count })}
          </span>
        </li>
      )}
    </ul>
  );
}

/**
 * Jobs from before the stored report existed carry a single signal payload in
 * job_reason_failure instead — render it with the same notice components the
 * old row panel used, so the modal never has less to say than the panel did.
 */
function LegacySignalNotices({ job }: Readonly<{ job: JobResponse }>) {
  const { t } = useTranslation('downloadsx');
  const truncation = parseTruncationPayload(job);
  const droppedAssets = parseDroppedAssetsPayload(job);
  const guessedColumns = parseColumnsGuessedPayload(job);
  const structureRescued = parseStructureRescuedPayload(job);
  const unsupportedBlocks = parseUnsupportedBlocksPayload(job);
  const forbiddenBlocks = parseForbiddenBlocksPayload(job);
  const cardLimitPartial = parseMonthlyLimitPartialPayload(job);
  const hasAnySignal =
    truncation != null ||
    droppedAssets != null ||
    guessedColumns != null ||
    structureRescued != null ||
    unsupportedBlocks != null ||
    forbiddenBlocks != null ||
    cardLimitPartial != null;

  if (!hasAnySignal) {
    return <p>{t('report.clean')}</p>;
  }
  return (
    <div className={styles.legacyNotices}>
      {truncation != null && (
        <TruncationNotice
          blocksConverted={truncation.blocksConverted}
          subDeckRulesSkipped={truncation.subDeckRulesSkipped}
        />
      )}
      {droppedAssets != null && <ImageDropNotice count={droppedAssets} />}
      {guessedColumns != null && (
        <ColumnsGuessedNotice
          frontField={guessedColumns.frontField}
          backField={guessedColumns.backField}
        />
      )}
      {structureRescued != null && (
        <StructureRescuedNotice rule={structureRescued.rule} />
      )}
      {forbiddenBlocks != null && (
        <ForbiddenBlocksNotice count={forbiddenBlocks.count} />
      )}
      {unsupportedBlocks != null && (
        <UnsupportedBlocksNotice counts={unsupportedBlocks} />
      )}
      {cardLimitPartial != null && (
        <MonthlyLimitPartialNotice
          cardsDelivered={cardLimitPartial.cardsDelivered}
          cardsHeldBack={cardLimitPartial.cardsHeldBack}
          limit={cardLimitPartial.limit}
        />
      )}
    </div>
  );
}

export function ConversionReportModal({
  job,
  onClose,
}: Readonly<ConversionReportModalProps>) {
  const { t } = useTranslation('downloadsx');
  const dialogRef = useDialog(true, onClose);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ConversionReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    get2ankiApi()
      .getJobReport(job.object_id)
      .catch(() => null)
      .then((fetched) => {
        if (cancelled) return;
        setReport(fetched);
        setLoading(false);
        track('conversion_report_opened', {
          source:
            job.type === 'page' || job.type === 'database'
              ? 'notion'
              : 'upload',
          blocks_skipped:
            fetched?.summary.blocks_skipped ?? getSignalSkippedCount(job),
          has_precheck_reason: false,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [job]);

  return (
    <dialog
      ref={dialogRef}
      className={sharedStyles.dialog}
      aria-labelledby="conversion-report-heading"
    >
      <div className={sharedStyles.modalCard}>
        <div className={sharedStyles.modalHeader}>
          <h2
            id="conversion-report-heading"
            className={sharedStyles.modalHeaderTitle}
          >
            {t('report.title')}
          </h2>
          <button
            type="button"
            className={sharedStyles.modalClose}
            onClick={onClose}
            aria-label={t('report.close')}
          >
            ×
          </button>
        </div>
        <div className={sharedStyles.modalBody}>
          {loading && <p>{t('report.loading')}</p>}
          {!loading && report != null && (
            <>
              <ReportSummary report={report} />
              <ReportEntries report={report} />
            </>
          )}
          {!loading && report == null && <LegacySignalNotices job={job} />}
        </div>
      </div>
    </dialog>
  );
}

export default ConversionReportModal;
