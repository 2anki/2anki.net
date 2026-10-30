import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { classifyUploadError } from '../../../../components/errors/helpers/getErrorMessage';
import { parseAmbiguousColumnsPayload } from '../../../../lib/fieldMapping/types';
import { usePassPrices } from '../../../../lib/hooks/usePassPrices';
import { get2ankiApi } from '../../../../lib/backend/get2ankiApi';
import { startUnlimitedUpgrade } from '../../../../lib/backend/startUnlimitedUpgrade';
import { track } from '../../../../lib/analytics/track';
import { formatResetDate } from './formatResetDate';
import type { RescueStatus } from '../../helpers/rescueStatus';
import { formatCount } from '../../../UploadPage/helpers/describeEmptyReading';
import type {
  RescueCandidate,
  RescueRule,
} from '../../../../lib/upload/isRescueCandidate';
import type {
  UploadErrorBody,
  UploadErrorCode,
} from '../../../../types/UploadErrorBody';
import sharedStyles from '../../../../styles/shared.module.css';
import styles from './ConversionResult.module.css';

// The server stores these identifiers verbatim in job_reason_failure. Without a
// code to key on, classifyUploadError falls through to its short-message branch
// and renders the identifier itself as the whole explanation. The designer copy
// for claude_parse_failed already ships in all 10 locales.
const CLAUDE_REASON_CODES: Record<string, UploadErrorCode> = {
  claude_parse_failed: 'claude_parse_failed',
  claude_response_truncated: 'claude_parse_failed',
};

const PAYWALL_SURFACE = 'downloads-limit';
const UNLIMITED_PRICING_HREF = `/pricing?source=${PAYWALL_SURFACE}`;

type Source = 'notion' | 'upload' | 'dropbox' | 'drive';

const NOTION_TOKEN_EXPIRED_REASON = 'notion_token_expired';
const EMPTY_DECK_REASON_PREFIX = 'No cards in this deck yet.';
// Markers the server embeds in the empty-deck message so the localized copy can
// branch on the reason. Keep in sync with EMPTY_DECK_ALL_FILTERED_REASON /
// EMPTY_DECK_NO_CONTENT_REASON / EMPTY_DECK_NOTION_EMPTY_PAGE_REASON /
// EMPTY_DECK_EMPTY_ANSWERS_REASON in src/usecases/jobs/jobFailureReason.ts.
const EMPTY_DECK_ALL_FILTERED_MARKER = 'card filter removed';
const EMPTY_DECK_NO_CONTENT_MARKER = 'no text we could read';
const EMPTY_DECK_NOTION_EMPTY_PAGE_MARKER = 'Notion page looks empty';
const EMPTY_DECK_EMPTY_ANSWERS_MARKER = 'no answer inside them';
const TOGGLES_DOCS_HREF = '/documentation/cards/notion-blocks';
const FILE_FORMATS_DOCS_HREF = '/documentation/reference/file-formats';
const CONNECT_NOTION_DOCS_HREF = '/documentation/start-here/connect-notion';

// A Map so a rule name off the wire can never reach an Object.prototype key.
const RESCUE_LABEL_KEYS = new Map<RescueRule, string>([
  ['columns', 'rescueColumns'],
  ['heading', 'rescueHeading'],
  ['quote', 'rescueQuote'],
  ['numbered', 'rescueNumbered'],
  ['bullets', 'rescueBullets'],
  ['guess', 'rescueGuess'],
  ['paragraphs', 'rescueParagraphs'],
]);

interface ProcessingProps {
  variant: 'processing';
  children: ReactNode;
}

interface PaywalledProps {
  variant: 'paywalled';
  title: string | null;
  limit: number;
  cardsUsed: number;
  resetOn?: string;
}

interface FailedProps {
  variant: 'failed';
  title: string | null;
  failureReason: string;
  source: Source;
  onMapColumns: () => void;
  rescue?: RescueCandidate[];
  onRescue?: (candidate: RescueCandidate) => void;
  rescueStatus?: RescueStatus | null;
}

interface SuccessProps {
  variant: 'success';
  count: number;
}

type ConversionResultProps =
  | ProcessingProps
  | PaywalledProps
  | FailedProps
  | SuccessProps;

function PaywalledVariant({
  limit,
  cardsUsed,
  resetOn,
}: Omit<PaywalledProps, 'variant' | 'title'>) {
  const { t } = useTranslation();
  const passPrices = usePassPrices();
  const shownFiredRef = useRef(false);
  const [pendingKind, setPendingKind] = useState<'24h' | '7d' | null>(null);
  const resetDate = formatResetDate(resetOn);

  useEffect(() => {
    if (shownFiredRef.current) return;
    shownFiredRef.current = true;
    track('paywall_shown', { surface: PAYWALL_SURFACE });
  }, []);

  const handlePassClick = async (kind: '24h' | '7d') => {
    track('paywall_pass_clicked', {
      surface: PAYWALL_SURFACE,
      plan: kind === '24h' ? 'day' : 'week',
    });
    setPendingKind(kind);
    const result = await get2ankiApi().startPassCheckout(
      kind,
      undefined,
      PAYWALL_SURFACE
    );
    if ('url' in result) {
      globalThis.location.href = result.url;
      return;
    }
    setPendingKind(null);
  };

  const handleUnlimitedClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (pendingKind != null) {
      return;
    }
    track('paywall_upgrade_clicked', {
      surface: PAYWALL_SURFACE,
      plan: 'unlimited',
    });
    await startUnlimitedUpgrade(PAYWALL_SURFACE);
  };

  return (
    <div className={styles.paywalled}>
      <p className={styles.paywallHeadline}>
        {cardsUsed >= limit
          ? t('conversionResult.paywall.headlineReached', { limit })
          : t('conversionResult.paywall.headlineUsed', { cardsUsed, limit })}
      </p>
      <p className={styles.paywallBody}>
        {resetDate == null
          ? t('conversionResult.paywall.bodyNoReset')
          : t('conversionResult.paywall.bodyWithReset', { resetDate })}
      </p>
      <div className={styles.paywallActions}>
        <button
          type="button"
          className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
          onClick={() => handlePassClick('24h')}
          disabled={pendingKind != null}
        >
          {pendingKind === '24h'
            ? t('conversionResult.paywall.openingCheckout')
            : t('conversionResult.paywall.getDayPass', {
                price: passPrices['24h'],
              })}
        </button>
        <button
          type="button"
          className={`${sharedStyles.btnSecondary} ${sharedStyles.btnInline}`}
          onClick={() => handlePassClick('7d')}
          disabled={pendingKind != null}
        >
          {pendingKind === '7d'
            ? t('conversionResult.paywall.openingCheckout')
            : t('conversionResult.paywall.getWeekPass', {
                price: passPrices['7d'],
              })}
        </button>
        <a
          href={UNLIMITED_PRICING_HREF}
          className={styles.seeAllPlans}
          onClick={handleUnlimitedClick}
          aria-disabled={pendingKind != null}
          tabIndex={pendingKind == null ? undefined : -1}
        >
          {t('conversionResult.paywall.upgradeUnlimited')}
        </a>
      </div>
    </div>
  );
}

const RESCUE_STATUS_KEYS: Record<
  Exclude<RescueStatus['kind'], 'limit'>,
  string
> = {
  building: 'conversionResult.rescueBuilding',
  oneAtATime: 'conversionResult.rescueOneAtATime',
  alreadyRunning: 'conversionResult.rescueAlreadyRunning',
  failed: 'conversionResult.rescueFailed',
};

function RescueStatusLine({
  status,
}: Readonly<{ status: RescueStatus | null }>) {
  const { t } = useTranslation();
  if (status == null) {
    return null;
  }
  if (status.kind === 'limit') {
    return (
      <>
        {t('conversionResult.rescueLimitReached', { limit: status.limit })}{' '}
        <Link to={UNLIMITED_PRICING_HREF}>
          {t('conversionResult.paywall.upgradeUnlimited')}
        </Link>
      </>
    );
  }
  return <>{t(RESCUE_STATUS_KEYS[status.kind])}</>;
}

function RescueOffer({
  rescue,
  onRescue,
  status,
}: Readonly<{
  rescue: RescueCandidate[];
  onRescue: (candidate: RescueCandidate) => void;
  status: RescueStatus | null;
}>) {
  const { t } = useTranslation();
  const building = status?.kind === 'building';
  return (
    <div className={styles.rescueActions}>
      <p className={styles.rescueLead}>
        {t('conversionResult.rescueLeadNotion')}
      </p>
      {rescue.map((candidate) => (
        <div key={candidate.rule} className={styles.rescueOption}>
          <button
            type="button"
            className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
            aria-disabled={building}
            aria-busy={building}
            onClick={() => {
              if (!building) onRescue(candidate);
            }}
          >
            {t(`upload.form.${RESCUE_LABEL_KEYS.get(candidate.rule)}`, {
              count: candidate.cards,
              n: formatCount(candidate.cards),
            })}
          </button>
          {candidate.sample != null && candidate.sample.length > 0 && (
            <ul className={styles.rescueSample} role="list">
              {candidate.sample.map((card, index) => (
                <li key={index} data-hj-suppress>
                  <span className={styles.rescueSampleFront}>{card.front}</span>
                  {card.back !== card.front && (
                    <span className={styles.rescueSampleBack}>{card.back}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className={styles.rescueStatus} role="status">
        <RescueStatusLine status={status} />
      </p>
    </div>
  );
}

function FailedVariant({
  failureReason,
  source,
  onMapColumns,
  rescue = [],
  onRescue,
  rescueStatus = null,
}: Omit<FailedProps, 'variant' | 'title'>) {
  const { t } = useTranslation();
  if (source === 'notion' && failureReason === NOTION_TOKEN_EXPIRED_REASON) {
    return (
      <div>
        <p>{t('conversionResult.notionExpired')}</p>
        <a href="/notion" className={sharedStyles.btnPrimary}>
          {t('conversionResult.reconnectNotion')}
        </a>
      </div>
    );
  }

  if (failureReason.startsWith(EMPTY_DECK_REASON_PREFIX)) {
    // The toggle teaching is right for Notion and wrong for everyone else: of
    // 227 firings in 30 days, 157 were people uploading a Word, PDF, or
    // Markdown file, told to go use a Notion feature they have no access to.
    // The reason markers let each empty-deck cause get copy that matches it.
    const fromNotion = source === 'notion';
    const emptyDeckPanel = (
      body: string,
      href: string,
      label: string,
      offer: ReactNode = null
    ) => (
      <div>
        <p>{body}</p>
        {offer}
        <Link
          to={href}
          className={`${offer == null ? sharedStyles.btnPrimary : sharedStyles.btnSecondary} ${sharedStyles.btnInline}`}
        >
          {label}
        </Link>
      </div>
    );

    if (failureReason.includes(EMPTY_DECK_ALL_FILTERED_MARKER)) {
      return emptyDeckPanel(
        t('conversionResult.emptyDeckAllFiltered'),
        TOGGLES_DOCS_HREF,
        t('conversionResult.togglesDocs')
      );
    }

    if (
      fromNotion &&
      failureReason.includes(EMPTY_DECK_NOTION_EMPTY_PAGE_MARKER)
    ) {
      return emptyDeckPanel(
        t('conversionResult.emptyDeckNotionEmptyPage'),
        CONNECT_NOTION_DOCS_HREF,
        t('conversionResult.connectNotionDocs')
      );
    }

    let teaching = t('conversionResult.emptyDeckTeachingUpload');
    if (failureReason.includes(EMPTY_DECK_NO_CONTENT_MARKER)) {
      teaching = t('conversionResult.emptyDeckNoContent');
    } else if (
      fromNotion &&
      failureReason.includes(EMPTY_DECK_EMPTY_ANSWERS_MARKER)
    ) {
      teaching = t('conversionResult.emptyDeckEmptyAnswers');
    } else if (fromNotion) {
      teaching = t('conversionResult.emptyDeckTeaching');
    }
    const offer =
      fromNotion && onRescue != null && rescue.length > 0 ? (
        <RescueOffer
          rescue={rescue}
          onRescue={onRescue}
          status={rescueStatus}
        />
      ) : null;
    return emptyDeckPanel(
      teaching,
      fromNotion ? TOGGLES_DOCS_HREF : FILE_FORMATS_DOCS_HREF,
      fromNotion
        ? t('conversionResult.togglesDocs')
        : t('conversionResult.uploadFormatsDocs'),
      offer
    );
  }

  if (parseAmbiguousColumnsPayload(failureReason) != null) {
    return (
      <div>
        <p>{t('conversionResult.ambiguousColumns')}</p>
        <button
          type="button"
          className={sharedStyles.btnPrimary}
          onClick={onMapColumns}
        >
          {t('conversionResult.mapColumns')}
        </button>
      </div>
    );
  }

  const isTooLarge =
    failureReason.includes('too large') ||
    failureReason.includes('MemoryError') ||
    failureReason.includes('Killed');
  const errorBody: UploadErrorBody = {
    code:
      CLAUDE_REASON_CODES[failureReason.trim()] ??
      (isTooLarge ? 'too_large' : 'unknown'),
    message: failureReason,
  };
  const friendly = classifyUploadError(errorBody);
  return (
    <>
      <p>
        {friendly.detail
          ? `${friendly.title} ${friendly.detail}`
          : friendly.title}
      </p>
      <p>
        {t('conversionResult.checkStatusPrefix')}
        <Link to="/status">{t('conversionResult.checkStatus')}</Link>
      </p>
    </>
  );
}

function SuccessVariant({ count }: Omit<SuccessProps, 'variant'>) {
  const { t } = useTranslation();
  return (
    <div className={styles.success}>
      <span className={styles.cardCount}>
        <span className={styles.cardCountNumber}>{count}</span>
        <span className={styles.cardCountLabel}>
          {t('conversionResult.success.card', { count })}
        </span>
      </span>
      <span className={styles.helperText}>
        {t('conversionResult.success.helper')}
      </span>
      <span className={styles.helperText}>
        {t('conversionResult.success.order')}
      </span>
    </div>
  );
}

export function ConversionResult(props: Readonly<ConversionResultProps>) {
  if (props.variant === 'processing') {
    return <>{props.children}</>;
  }

  if (props.variant === 'success') {
    return <SuccessVariant count={props.count} />;
  }

  if (props.variant === 'paywalled') {
    return (
      <PaywalledVariant
        limit={props.limit}
        cardsUsed={props.cardsUsed}
        resetOn={props.resetOn}
      />
    );
  }

  return (
    <FailedVariant
      failureReason={props.failureReason}
      source={props.source}
      onMapColumns={props.onMapColumns}
      rescue={props.rescue}
      onRescue={props.onRescue}
      rescueStatus={props.rescueStatus}
    />
  );
}
