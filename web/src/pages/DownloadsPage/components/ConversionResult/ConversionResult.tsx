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
import { PASS_PRICES } from '../../../PricingPage/payment.links';
import { get2ankiApi } from '../../../../lib/backend/get2ankiApi';
import { startUnlimitedUpgrade } from '../../../../lib/backend/startUnlimitedUpgrade';
import { track } from '../../../../lib/analytics/track';
import { formatResetDate } from './formatResetDate';
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
const TOGGLES_DOCS_HREF = '/documentation/cards/notion-blocks';
const FILE_FORMATS_DOCS_HREF = '/documentation/reference/file-formats';

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
                price: PASS_PRICES['24h'],
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
                price: PASS_PRICES['7d'],
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

function FailedVariant({
  failureReason,
  source,
  onMapColumns,
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
    const fromNotion = source === 'notion';
    return (
      <div>
        <p>
          {fromNotion
            ? t('conversionResult.emptyDeckTeaching')
            : t('conversionResult.emptyDeckTeachingUpload')}
        </p>
        <Link
          to={fromNotion ? TOGGLES_DOCS_HREF : FILE_FORMATS_DOCS_HREF}
          className={`${sharedStyles.btnPrimary} ${sharedStyles.btnInline}`}
        >
          {fromNotion
            ? t('conversionResult.togglesDocs')
            : t('conversionResult.uploadFormatsDocs')}
        </Link>
      </div>
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
    />
  );
}
