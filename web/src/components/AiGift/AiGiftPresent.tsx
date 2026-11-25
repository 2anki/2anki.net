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

// What the page knows about the signed-in account: whether it pays for a plan
// and, if so, whether its plan turns Claude on by default for PDF and
// PowerPoint uploads. Left out where the page does not know, and then the
// panel makes no claim about AI being on or off.
export interface PanelAccount {
  paying: boolean;
  claudeCardsByDefault: boolean;
}

type NextUploadClaude =
  | 'unknown'
  | 'inUse'
  | 'short'
  | 'on'
  | 'onForPdfs'
  | 'off';

const claudeSwitchedOnHere = (): boolean =>
  globalThis.localStorage?.getItem('claude-ai-flashcards') === 'true';

// The upload page's own reading of the default: it holds until the person
// records a choice, and a PDF made two pages per card skips it.
const defaultHoldsHere = (serverDefault: boolean): boolean =>
  serverDefault &&
  !hasRecordedAiChoice() &&
  globalThis.localStorage?.getItem('pdf-page-pairs') !== 'true';

function giftAccountClaude(gift: ClaimedGift): NextUploadClaude {
  const left = gift.monthlyCardsLeft;
  const minimum = gift.minMonthlyCards;
  if (left == null || minimum == null || gift.claudeByDefaultOnGift == null) {
    return 'unknown';
  }
  if (left < minimum) return 'short';
  if (claudeSwitchedOnHere()) return 'on';
  return defaultHoldsHere(gift.claudeByDefaultOnGift) ? 'onForPdfs' : 'off';
}

// What the server will do with the next PDF or PowerPoint upload: the plan's
// default for a paying account, the gift status for one with no plan, and a
// switch the person turned on themselves for either.
function nextUploadClaude(
  gift: ClaimedGift,
  account: PanelAccount | undefined
): NextUploadClaude {
  if (account == null) return 'unknown';
  if (gift.inUse === true) return 'inUse';
  if (!account.paying) return giftAccountClaude(gift);
  if (claudeSwitchedOnHere()) return 'on';
  return defaultHoldsHere(account.claudeCardsByDefault) ? 'onForPdfs' : 'off';
}

function claudeLineKey(
  state: NextUploadClaude,
  paying: boolean
): string | null {
  switch (state) {
    case 'inUse':
      return 'inUseNow';
    case 'short':
      return 'fewCardsLeft';
    case 'on':
      return paying ? 'aiOnPlan' : 'nextFile';
    case 'onForPdfs':
      return 'nextPdf';
    case 'off':
      return 'aiOffPlan';
    default:
      return null;
  }
}

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
  const lineKey = claudeLineKey(state, paying);
  const offersFile = state !== 'unknown' && state !== 'inUse';

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
