import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import GiftIcon from '../icons/GiftIcon';
import { useAiGift, AI_GIFT_QUERY_KEY } from '../../lib/hooks/useAiGift';
import { useDialogFocus } from '../../lib/hooks/useDialogFocus';
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
} from './giftUiState';
import styles from './AiGiftPresent.module.css';

const GIFT_RETURN_PATH = '/upload';

interface AiGiftPresentProps {
  isLoggedIn: boolean;
  align?: 'start' | 'end';
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
}: Readonly<PanelBodyProps>) {
  const { t } = useTranslation('aiGift');
  const language = useAppLanguage();
  const { pathname } = useLocation();
  const onUploadPage = pathname === GIFT_RETURN_PATH;

  if (gift.state === 'full') {
    return <p className={styles.text}>{t('full')}</p>;
  }

  if (gift.state === 'claimed') {
    return (
      <>
        <p className={styles.text}>{t('claimed', { count: gift.credits })}</p>
        <p className={styles.text}>
          {t('claimedExpires', {
            date: formatGiftDate(gift.expiresAt, language),
          })}
        </p>
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
        {t('body', { credits: gift.credits, hours: gift.hours })}
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
}: Readonly<AiGiftPresentProps>) {
  const { t } = useTranslation('aiGift');
  const gift = useAiGift(isLoggedIn);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const panelId = useId();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [openChoice, setOpen] = useState<boolean | null>(null);
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
    if (openedOnReturn) forgetClaimIntent();
  }, [openedOnReturn]);

  useDialogFocus(panelRef, () => setOpen(false), open);

  if (!visible) return null;

  const onToggle = () => {
    if (!open) {
      track('ai_gift_opened', { state: gift.state, signed_in: isLoggedIn });
    }
    setOpen(!open);
  };

  const onClaim = async () => {
    track('ai_gift_claim_clicked', { signed_in: true });
    setClaiming(true);
    setRefusal(null);
    const result = await claimAiGift();
    setClaiming(false);
    if (result.ok) {
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
    track('ai_gift_claim_clicked', { signed_in: false, page });
    rememberClaimIntent(Date.now());
    setOpen(false);
    navigate(`${page}?redirect=${encodeURIComponent(GIFT_RETURN_PATH)}`);
  };

  const onHide = () => {
    setGiftDismissed(true);
    setDismissed(true);
    setOpen(false);
  };

  const triggerClass = dismissed ? styles.triggerQuiet : styles.trigger;
  const panelClass =
    align === 'start' ? `${styles.panel} ${styles.panelStart}` : styles.panel;

  return (
    <div className={styles.present}>
      <button
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
          <span className={styles.triggerText} aria-hidden="true">
            {t('triggerText')}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
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
              onClick={() => setOpen(false)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <PanelBody
            gift={gift}
            isLoggedIn={isLoggedIn}
            claiming={claiming}
            refusal={refusal}
            onClaim={onClaim}
            onSignUp={() => leaveToAuth('/register')}
            onSignIn={() => leaveToAuth('/login')}
            onUse={() => setOpen(false)}
          />
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
