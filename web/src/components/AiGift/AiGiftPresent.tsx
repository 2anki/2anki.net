import { useEffect, useId, useRef, useState, type RefCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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

interface PanelBodyProps {
  gift: VisibleGift;
  isLoggedIn: boolean;
  claiming: boolean;
  refusal: AiGiftRefusal | null;
  onClaim: () => void;
  onSignUp: () => void;
  onSignIn: () => void;
  onUse: () => void;
  resultRef: RefCallback<HTMLParagraphElement>;
  planCreditsFirst: boolean;
}

function PanelBody({
  gift,
  isLoggedIn,
  claiming,
  refusal,
  onClaim,
  onSignUp,
  onSignIn,
  onUse,
  resultRef,
  planCreditsFirst,
}: Readonly<PanelBodyProps>) {
  const { t } = useTranslation('aiGift');
  const language = useAppLanguage();
  const { pathname } = useLocation();
  const onUploadPage = pathname === GIFT_RETURN_PATH;

  if (gift.state === 'full') {
    return (
      <p ref={resultRef} tabIndex={-1} className={styles.text}>
        {t('full')}
      </p>
    );
  }

  if (gift.state === 'claimed') {
    return (
      <>
        <p ref={resultRef} tabIndex={-1} className={styles.text}>
          {t('claimed', { count: gift.credits })}
        </p>
        <p className={styles.text}>
          {t('claimedExpires', {
            date: formatGiftDate(gift.expiresAt, language),
          })}
        </p>
        {planCreditsFirst && <p className={styles.note}>{t('planFirst')}</p>}
        {!onUploadPage && (
          <Link to={GIFT_RETURN_PATH} className={styles.link} onClick={onUse}>
            {t('useThem')}
          </Link>
        )}
      </>
    );
  }

  return (
    <>
      <p className={styles.text}>
        {t('body', {
          credits: gift.credits,
          date: formatGiftDate(gift.expiresIfClaimedNow, language),
        })}
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
          {claiming ? t('claiming') : t('claim', { credits: gift.credits })}
        </button>
      ) : (
        <>
          <button
            type="button"
            className={styles.claimButton}
            onClick={onSignUp}
          >
            {t('signUpToClaim')}
          </button>
          <p className={styles.note}>
            {t('haveAccount')}{' '}
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

  useEffect(() => {
    if (!openedOnReturn) return;
    forgetClaimIntent();
    rememberGiftOpened();
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

  const onClaim = async () => {
    track('ai_gift_claim_clicked', { signed_in: true, trigger: openedBy });
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
              onClaim={onClaim}
              onSignUp={() => leaveToAuth('/register')}
              onSignIn={() => leaveToAuth('/login')}
              onUse={() => setOpen(false)}
              resultRef={resultRef}
              planCreditsFirst={planCreditsFirst}
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
