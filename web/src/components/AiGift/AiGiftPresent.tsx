import { useEffect, useId, useRef, useState, type RefCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import GiftIcon from '../icons/GiftIcon';
import { useAiGift, AI_GIFT_QUERY_KEY } from '../../lib/hooks/useAiGift';
import { useAppLanguage } from '../../lib/i18n/useAppLanguage';
import {
  claimAiGift,
  type AiGiftRefusal,
  type AiGiftStatus,
} from '../../lib/backend/aiGift';
import { track } from '../../lib/analytics/track';
import { trackNoticeOncePerLoad } from '../../lib/analytics/trackNoticeOncePerLoad';
import {
  isGiftDismissed,
  rememberClaimIntent,
  setGiftDismissed,
  forgetClaimIntent,
  hasClaimIntent,
  rememberGiftOpened,
} from './giftUiState';
import { useGiftAutoOpen } from './useGiftAutoOpen';
import { useUploadZoneActivity } from '../../lib/upload/uploadZoneActivity';
import { chooseUploadFile } from '../../lib/upload/uploadEntry';
import { hasRecordedAiChoice } from '../../lib/data_layer/aiChoice';
import { savedCardSettings } from '../../lib/upload/savedCardSettings';
import sharedStyles from '../../styles/shared.module.css';
import styles from './AiGiftPresent.module.css';

const GIFT_RETURN_PATH = '/upload';

type GiftOpenTrigger = 'auto' | 'click' | 'return';
type GiftDismissVia =
  | 'escape'
  | 'outside'
  | 'close'
  | 'toggle'
  | 'hide'
  | 'upload';

interface AiGiftPresentProps {
  isLoggedIn: boolean;
  align?: 'start' | 'end';
  className?: string;
  labelFromWide?: boolean;
  planCreditsFirst?: boolean;
  account?: PanelAccount;
}

// Whether the signed-in account pays for a plan, when the page knows. Left
// out where it does not, and then the panel makes no claim about AI.
export interface PanelAccount {
  paying: boolean;
}

type NextUploadClaude =
  | 'unknown'
  | 'inUse'
  | 'usedUp'
  | 'short'
  | 'on'
  | 'onForPdfs'
  | 'off';

// A PDF made two pages per card, or not processed at all, never reaches
// Claude on the server. The status answers for the account's saved options;
// the browser's own copy is read here, since an upload sends that one.
function pdfKeptFromClaude(
  sent: Record<string, string>,
  gift: ClaimedGift
): boolean {
  return (
    gift.storedPdfSkipsClaude === true ||
    sent['pdf-page-pairs'] === 'true' ||
    sent['process-pdfs'] === 'false'
  );
}

// The server answers what a PDF upload would get (claudeDefaultForPdf, from
// the upload's own default rule) and whether that upload would have budget
// (aiBudgetAvailable, from its own budget check); the panel only adds the
// person's own switch. It promises Claude when the default or their switch
// is on and the budget, the month and the gift allow it, says AI is off only
// when they turned it off themselves, and otherwise makes no claim.
function nextUploadClaude(
  gift: ClaimedGift,
  account: PanelAccount | undefined
): NextUploadClaude {
  if (account == null) return 'unknown';
  if (gift.inUse === true) return 'inUse';
  if (!account.paying && gift.credits <= 0) return 'usedUp';
  const sent = savedCardSettings();
  const switchedOn = sent['claude-ai-flashcards'] === 'true';
  if (hasRecordedAiChoice() && !switchedOn) return 'off';
  if (pdfKeptFromClaude(sent, gift)) return 'unknown';
  const left = gift.monthlyCardsLeft;
  const minimum = gift.minMonthlyCards;
  const monthKnown = left != null && minimum != null;
  if (!account.paying && monthKnown && left < minimum) return 'short';
  const monthAllows = account.paying || monthKnown;
  const claudeOn = gift.claudeDefaultForPdf === true || switchedOn;
  if (claudeOn && gift.aiBudgetAvailable === true && monthAllows) {
    return switchedOn ? 'on' : 'onForPdfs';
  }
  return 'unknown';
}

const CLAUDE_LINE: Record<Exclude<NextUploadClaude, 'unknown'>, string> = {
  inUse: 'inUseNow',
  usedUp: 'usedUp',
  short: 'fewCardsLeft',
  on: 'nextFile',
  onForPdfs: 'nextPdf',
  off: 'aiOffPlan',
};

const dateLocale = (language: string): string =>
  language.startsWith('en') ? 'en-GB' : language;

export function formatGiftDate(iso: string, language: string): string {
  return new Date(iso).toLocaleString(dateLocale(language), {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function refusalKey(reason: AiGiftRefusal): string {
  switch (reason) {
    case 'gift_already_claimed':
      return 'refused.alreadyClaimed';
    case 'gift_ip_limit':
      return 'refused.ipLimit';
    case 'gift_closed':
      return 'refused.closed';
    case 'gift_budget_full':
      return 'full';
    default:
      return 'refused.generic';
  }
}

type VisibleGift = Exclude<AiGiftStatus, { state: 'closed' }>;
type ClaimedGift = Extract<AiGiftStatus, { state: 'claimed' }>;

interface ClaimedBodyProps {
  gift: ClaimedGift;
  account: PanelAccount | undefined;
  planCreditsFirst: boolean;
  onChooseFile: () => void;
  resultRef: RefCallback<HTMLParagraphElement>;
}

function ClaimedBody({
  gift,
  account,
  planCreditsFirst,
  onChooseFile,
  resultRef,
}: Readonly<ClaimedBodyProps>) {
  const { t } = useTranslation('aiGift');
  const language = useAppLanguage();
  const date = formatGiftDate(gift.expiresAt, language);
  const chooseFile = (
    <button type="button" className={styles.claimButton} onClick={onChooseFile}>
      {t('chooseFile')}
    </button>
  );

  const state = nextUploadClaude(gift, account);
  const paying = account?.paying !== false;
  const lineKey = state === 'unknown' ? null : CLAUDE_LINE[state];
  const offersFile =
    state === 'on' ||
    state === 'onForPdfs' ||
    state === 'off' ||
    state === 'short';

  return (
    <>
      <p ref={resultRef} tabIndex={-1} className={styles.text}>
        {paying
          ? t('claimed', { count: gift.credits })
          : t('balanceAlone', { count: gift.credits, date })}
      </p>
      {paying && <p className={styles.text}>{t('claimedExpires', { date })}</p>}
      {paying && planCreditsFirst && (
        <p className={styles.note}>{t('planFirst')}</p>
      )}
      {lineKey != null && (
        <p className={styles.text}>
          {t(lineKey, { count: gift.monthlyCardsLeft ?? 0 })}
        </p>
      )}
      {state === 'onForPdfs' && (
        <p className={styles.text}>{t('otherUploads')}</p>
      )}
      {(state === 'on' || state === 'onForPdfs') && (
        <p className={styles.note}>{t('turnOffHint')}</p>
      )}
      {offersFile && chooseFile}
    </>
  );
}

interface PanelBodyProps {
  gift: VisibleGift;
  isLoggedIn: boolean;
  claiming: boolean;
  refusal: AiGiftRefusal | null;
  onClaim: () => void;
  onSignUp: () => void;
  onSignIn: () => void;
  onChooseFile: () => void;
  resultRef: RefCallback<HTMLParagraphElement>;
  planCreditsFirst: boolean;
  account: PanelAccount | undefined;
}

function PanelBody({
  gift,
  isLoggedIn,
  claiming,
  refusal,
  onClaim,
  onSignUp,
  onSignIn,
  onChooseFile,
  resultRef,
  planCreditsFirst,
  account,
}: Readonly<PanelBodyProps>) {
  const { t } = useTranslation('aiGift');
  const language = useAppLanguage();

  if (gift.state === 'full') {
    return (
      <p ref={resultRef} tabIndex={-1} className={styles.text}>
        {t('full')}
      </p>
    );
  }

  if (gift.state === 'claimed') {
    return (
      <ClaimedBody
        gift={gift}
        account={account}
        planCreditsFirst={planCreditsFirst}
        onChooseFile={onChooseFile}
        resultRef={resultRef}
      />
    );
  }

  return (
    <>
      <p className={styles.text}>
        {gift.lastsHours == null
          ? t('bodyUntil', {
              date: formatGiftDate(gift.expiresIfClaimedNow, language),
            })
          : t('body', { count: gift.lastsHours })}
      </p>
      <p className={styles.note}>
        {t('claimUntil', {
          date: formatGiftDate(gift.claimClosesAt, language),
        })}
      </p>
      {refusal != null && (
        <p className={styles.refusal} role="alert">
          {t(refusalKey(refusal))}
        </p>
      )}
      {isLoggedIn ? (
        <button
          type="button"
          className={styles.claimButton}
          onClick={onClaim}
          disabled={claiming}
        >
          {claiming ? t('claiming') : t('claim')}
        </button>
      ) : (
        <>
          <button
            type="button"
            className={styles.claimButton}
            onClick={onSignUp}
          >
            {t('claim')}
          </button>
          <p className={styles.note}>
            {t('needsAccount')} {t('haveAccount')}{' '}
            <button
              type="button"
              className={styles.inlineLink}
              onClick={onSignIn}
            >
              {t('signIn')}
            </button>
          </p>
        </>
      )}
    </>
  );
}

export function AiGiftPresent({
  isLoggedIn,
  align = 'end',
  className,
  labelFromWide = false,
  planCreditsFirst = false,
  account,
}: Readonly<AiGiftPresentProps>) {
  const { t } = useTranslation('aiGift');
  const gift = useAiGift(isLoggedIn);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const panelId = useId();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusResultNext = useRef(false);
  const [openChoice, setOpen] = useState<boolean | null>(null);
  const [openedBy, setOpenedBy] = useState<GiftOpenTrigger>('return');
  const [announcement, setAnnouncement] = useState('');
  const [returnedToClaim] = useState(
    () => isLoggedIn && hasClaimIntent(Date.now())
  );
  const [dismissed, setDismissed] = useState(isGiftDismissed);
  const [claiming, setClaiming] = useState(false);
  const [refusal, setRefusal] = useState<AiGiftRefusal | null>(null);

  const visible = gift != null && gift.state !== 'closed';

  useEffect(() => {
    if (!visible) return;
    trackNoticeOncePerLoad('ai_gift_shown', 'present', {
      state: gift.state,
      signed_in: isLoggedIn,
    });
  }, [visible, gift?.state, isLoggedIn]);

  const openedOnReturn = returnedToClaim && gift?.state === 'open';
  const open = openChoice ?? openedOnReturn;

  const claim = async (automatic: boolean) => {
    track(
      'ai_gift_claim_clicked',
      automatic
        ? { signed_in: true, trigger: 'return', automatic: true }
        : { signed_in: true, trigger: openedBy }
    );
    setClaiming(true);
    setRefusal(null);
    const result = await claimAiGift();
    setClaiming(false);
    if (result.ok) {
      focusResultNext.current = true;
      const claimed: AiGiftStatus = {
        state: 'claimed',
        credits: result.credits,
        expiresAt: result.expiresAt,
        feedbackDue: false,
      };
      queryClient.setQueriesData<AiGiftStatus>(
        { queryKey: AI_GIFT_QUERY_KEY },
        () => claimed
      );
      void queryClient.invalidateQueries({ queryKey: AI_GIFT_QUERY_KEY });
      return;
    }
    if (result.reason === 'gift_budget_full') {
      focusResultNext.current = true;
      const full: AiGiftStatus = { state: 'full', feedbackDue: false };
      queryClient.setQueriesData<AiGiftStatus>(
        { queryKey: AI_GIFT_QUERY_KEY },
        () => full
      );
      return;
    }
    setRefusal(result.reason);
  };

  const claimAs = useRef<(automatic: boolean) => Promise<void>>(
    async () => undefined
  );
  useEffect(() => {
    claimAs.current = claim;
  });
  const claimedOnReturn = useRef(false);
  useEffect(() => {
    if (!openedOnReturn || claimedOnReturn.current) return;
    claimedOnReturn.current = true;
    forgetClaimIntent();
    rememberGiftOpened();
    setOpenedBy('return');
    setOpen(true);
    void claimAs.current(true);
  }, [openedOnReturn]);

  useGiftAutoOpen(
    gift?.state === 'open' && !open && !returnedToClaim && !dismissed,
    () => {
      track('ai_gift_opened', {
        state: 'open',
        signed_in: isLoggedIn,
        trigger: 'auto',
      });
      rememberGiftOpened();
      setOpenedBy('auto');
      setAnnouncement(t('title'));
      setOpen(true);
    }
  );

  const giftState = gift?.state;
  const closeAs = useRef<(via: GiftDismissVia) => void>(() => undefined);
  useEffect(() => {
    closeAs.current = (via) => {
      track('ai_gift_dismissed', {
        trigger: openedBy,
        via,
        state: giftState,
        signed_in: isLoggedIn,
      });
      setOpen(false);
    };
  });

  const uploadZone = useUploadZoneActivity();
  useEffect(() => {
    if (open && openedBy === 'auto' && uploadZone === 'busy') {
      const focusInside = rootRef.current?.contains(document.activeElement);
      closeAs.current('upload');
      if (focusInside === true) triggerRef.current?.focus();
    }
  }, [open, openedBy, uploadZone]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const focusInside = rootRef.current?.contains(document.activeElement);
      closeAs.current('escape');
      if (openedBy !== 'auto' || focusInside === true) {
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeAs.current('outside');
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, openedBy]);

  if (!visible) return null;

  const closeToTrigger = (via: GiftDismissVia) => {
    closeAs.current(via);
    triggerRef.current?.focus();
  };

  const resultRef: RefCallback<HTMLParagraphElement> = (node) => {
    if (node != null && focusResultNext.current) {
      focusResultNext.current = false;
      node.focus();
    }
  };

  const onToggle = () => {
    if (open) {
      closeAs.current('toggle');
      return;
    }
    track('ai_gift_opened', {
      state: gift.state,
      signed_in: isLoggedIn,
      trigger: 'click',
    });
    rememberGiftOpened();
    setOpenedBy('click');
    setOpen(true);
  };

  const onChooseFile = () => {
    const outcome = chooseUploadFile();
    track('ai_gift_choose_file_clicked', { outcome });
    setOpen(false);
    if (outcome === 'page') navigate(GIFT_RETURN_PATH);
  };

  const leaveToAuth = (page: '/register' | '/login') => {
    track('ai_gift_claim_clicked', {
      signed_in: false,
      page,
      trigger: openedBy,
    });
    rememberClaimIntent(Date.now());
    setOpen(false);
    navigate(`${page}?redirect=${encodeURIComponent(GIFT_RETURN_PATH)}`);
  };

  const onHide = () => {
    setGiftDismissed(true);
    setDismissed(true);
    closeToTrigger('hide');
  };

  const triggerClass = dismissed ? styles.triggerQuiet : styles.trigger;
  const panelClass = [
    styles.panel,
    align === 'start' ? styles.panelStart : null,
    openedBy === 'auto' ? styles.panelAuto : null,
  ]
    .filter((name) => name != null)
    .join(' ');

  const textClass = labelFromWide
    ? `${styles.triggerText} ${styles.triggerTextWide}`
    : styles.triggerText;

  return (
    <div
      ref={rootRef}
      className={
        className == null ? styles.present : `${styles.present} ${className}`
      }
    >
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('triggerLabel')}
        onClick={onToggle}
      >
        <GiftIcon
          width={20}
          height={20}
          boxStroke="var(--gift-red)"
          ribbonStroke="var(--gift-green)"
        />
        {!dismissed && (
          <span className={textClass} aria-hidden="true">
            {t('triggerText')}
          </span>
        )}
      </button>
      <p className={sharedStyles.srOnly} role="status">
        {announcement}
      </p>
      {open && (
        <div
          id={panelId}
          className={panelClass}
          role="dialog"
          aria-labelledby={titleId}
        >
          <div className={styles.panelHeader}>
            <h2 id={titleId} className={styles.title}>
              <GiftIcon
                width={18}
                height={18}
                boxStroke="var(--gift-red)"
                ribbonStroke="var(--gift-green)"
              />
              {t('title')}
            </h2>
            <button
              type="button"
              className={styles.closeButton}
              aria-label={t('close')}
              onClick={() => closeToTrigger('close')}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className={styles.body} aria-live="polite">
            <PanelBody
              gift={gift}
              isLoggedIn={isLoggedIn}
              claiming={claiming}
              refusal={refusal}
              onClaim={() => void claim(false)}
              onSignUp={() => leaveToAuth('/register')}
              onSignIn={() => leaveToAuth('/login')}
              onChooseFile={onChooseFile}
              resultRef={resultRef}
              planCreditsFirst={planCreditsFirst}
              account={account}
            />
          </div>
          {!dismissed && (
            <button
              type="button"
              className={styles.hideButton}
              onClick={onHide}
            >
              {t('hide')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
