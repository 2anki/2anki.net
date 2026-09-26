import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCardUsage } from '../../lib/hooks/useCardUsage';
import {
  useAiCredits,
  type AiCreditsState,
} from '../../lib/hooks/useAiCredits';
import { useDialogFocus } from '../../lib/hooks/useDialogFocus';
import { track } from '../../lib/analytics/track';
import { formatLongDate } from '../../pages/AccountPage/utils/formatLongDate';
import {
  getPlanLabel,
  isPayingUser,
} from '../NavigationBar/helpers/getPlanLabel';
import { ThemeSwitcher } from '../ThemeSwitcher/ThemeSwitcher';
import { LanguagePicker } from '../LanguagePicker/LanguagePicker';
import type { SidebarLocals } from './Sidebar';
import styles from './AppShell.module.css';

const NEAR_LIMIT_RATIO = 0.8;
const LOW_CREDITS_THRESHOLD = 25;

function describeRing(
  ring: BalanceRing | null,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  if (ring == null) return null;
  if (ring.kind === 'cards') {
    return t('nav.accountMenu.cardsLeft', {
      remaining: ring.remaining,
      limit: ring.total,
    });
  }
  return t('aicredits:left', { count: ring.remaining });
}

interface CardUsageLineProps {
  used: number;
  limit: number;
}

function CardUsageLine({ used, limit }: Readonly<CardUsageLineProps>) {
  const { t } = useTranslation();
  const atLimit = used >= limit;
  const approaching = !atLimit && used >= limit * NEAR_LIMIT_RATIO;
  const heroClass =
    approaching || atLimit
      ? `${styles.identityUsageHero} ${styles.identityUsageWarning}`
      : styles.identityUsageHero;
  const restClass =
    approaching || atLimit
      ? `${styles.identityUsageRest} ${styles.identityUsageWarning}`
      : styles.identityUsageRest;
  return (
    <span className={styles.identityUsage}>
      <span className={heroClass}>{used}</span>
      <span className={restClass}> / {t('nav.cardsThisMonth', { limit })}</span>
    </span>
  );
}

function AiCreditsLine({
  credits,
}: Readonly<{ credits: AiCreditsState | null }>) {
  const { t, i18n } = useTranslation('aicredits');

  if (credits == null) {
    return null;
  }

  if (!credits.usable) {
    if (credits.credits > 0 && credits.windowEnd != null) {
      const pausedThrough = formatLongDate(
        new Date(credits.windowEnd),
        i18n.language
      );
      return (
        <span
          className={`${styles.identityUsage} ${styles.identityUsageWarning} ${styles.identityAiCredits}`}
        >
          {t('paused', { count: credits.credits, date: pausedThrough })}
        </span>
      );
    }
    return null;
  }

  const low = credits.credits <= LOW_CREDITS_THRESHOLD;
  return (
    <span
      className={
        low
          ? `${styles.identityUsage} ${styles.identityUsageWarning} ${styles.identityAiCredits}`
          : `${styles.identityUsage} ${styles.identityAiCredits}`
      }
    >
      {credits.credits <= 0 ? t('zero') : t('left', { count: credits.credits })}
      {low && (
        <Link
          to="/account"
          onClick={() => track('credits_sidebar_link_clicked')}
          className={styles.identityUsageUpgrade}
        >
          {t('buyShort')}
        </Link>
      )}
    </span>
  );
}

function avatarInitial(email: string | null | undefined): string {
  const first = email?.trim().charAt(0);
  return first ? first.toUpperCase() : '?';
}

const LOW_BALANCE_RATIO = 0.2;
const RING_RADIUS = 17;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface BalanceRing {
  remaining: number;
  total: number;
  kind: 'cards' | 'aiCredits';
}

function clampFraction(remaining: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, remaining / total));
}

export function pickBalanceRing(
  usage: { cards_used: number; cards_limit: number } | null,
  credits: AiCreditsState | null
): BalanceRing | null {
  if (usage != null && usage.cards_limit > 0) {
    return {
      remaining: Math.max(0, usage.cards_limit - usage.cards_used),
      total: usage.cards_limit,
      kind: 'cards',
    };
  }
  if (credits?.usable) {
    const total =
      credits.allowance > 0
        ? credits.allowance
        : credits.used + credits.credits;
    if (total > 0) {
      return {
        remaining: Math.max(0, credits.credits),
        total,
        kind: 'aiCredits',
      };
    }
  }
  return null;
}

function AvatarRing({ ring }: Readonly<{ ring: BalanceRing }>) {
  const fraction = clampFraction(ring.remaining, ring.total);
  const low = fraction <= LOW_BALANCE_RATIO;
  return (
    <svg
      className={
        low ? `${styles.avatarRing} ${styles.avatarRingLow}` : styles.avatarRing
      }
      viewBox="0 0 40 40"
      aria-hidden="true"
      data-testid="avatar-balance-ring"
      data-kind={ring.kind}
      data-fraction={fraction.toFixed(2)}
      data-low={low ? 'true' : 'false'}
    >
      <circle
        className={styles.avatarRingTrack}
        cx="20"
        cy="20"
        r={RING_RADIUS}
      />
      <circle
        className={styles.avatarRingValue}
        cx="20"
        cy="20"
        r={RING_RADIUS}
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
      />
    </svg>
  );
}

interface AccountMenuProps {
  email: string | null | undefined;
  locals: SidebarLocals | undefined | null;
  onLogOut: (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => void;
}

export function AccountMenu({
  email,
  locals,
  onLogOut,
}: Readonly<AccountMenuProps>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);
  const panelId = useId();
  const isLoggedIn = locals != null;
  const paying = isPayingUser(locals);
  const planLabel = getPlanLabel(locals);
  const usage = useCardUsage(isLoggedIn && !paying);
  const credits = useAiCredits(isLoggedIn);
  const showUsage = usage != null && !usage.unlimited && !usage.loading;
  const usageForRing = showUsage && usage ? usage : null;
  const ring = usage?.loading ? null : pickBalanceRing(usageForRing, credits);
  const ringDescription = describeRing(ring, t);

  const close = () => setOpen(false);

  useDialogFocus(panelRef, close, open);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const toggle = () => {
    if (!open) track('account_menu_opened');
    setOpen((value) => !value);
  };

  const onUpgradeClick = () => {
    track('upgrade_clicked', { source: 'avatar' });
    close();
  };

  return (
    <div className={styles.accountMenu} ref={rootRef}>
      <button
        type="button"
        className={styles.avatarButton}
        aria-label={
          ringDescription
            ? `${t('nav.accountMenu.open')}. ${ringDescription}`
            : t('nav.accountMenu.open')
        }
        title={ringDescription ?? undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        {ring && <AvatarRing ring={ring} />}
        <span className={styles.avatarInitial} aria-hidden="true">
          {avatarInitial(email)}
        </span>
      </button>
      {open && (
        <dialog
          open
          id={panelId}
          ref={panelRef}
          aria-label={t('nav.accountMenu.open')}
          tabIndex={-1}
          className={styles.accountPanel}
        >
          <div className={styles.accountHeader}>
            <span
              className={styles.identityEmail}
              title={email ?? undefined}
              data-hj-suppress
            >
              {email ?? t('nav.account')}
            </span>
            <span className={styles.identityPlan}>{planLabel}</span>
          </div>
          <div className={styles.accountBalance}>
            {showUsage && usage && (
              <CardUsageLine
                used={usage.cards_used}
                limit={usage.cards_limit}
              />
            )}
            {paying && (
              <span className={styles.identityUsage}>
                {t('nav.accountMenu.cardsUnlimited')}
              </span>
            )}
            <AiCreditsLine credits={credits} />
            {!paying && (
              <Link
                to="/pricing?from=avatar"
                onClick={onUpgradeClick}
                className={styles.accountUpgrade}
              >
                {t('nav.accountMenu.upgrade')}
              </Link>
            )}
            {locals?.subscriber && !locals.patreon && (
              <Link
                to="/account"
                onClick={close}
                className={styles.accountAction}
              >
                {t('nav.accountMenu.manageSubscription')}
              </Link>
            )}
          </div>
          <div className={styles.accountGroup}>
            <Link to="/account" onClick={close} className={styles.accountRow}>
              {t('nav.account')}
            </Link>
            <Link
              to="/card-options"
              onClick={close}
              className={styles.accountRow}
            >
              {t('nav.accountMenu.cardSettings')}
            </Link>
          </div>
          <div className={styles.accountPreferences}>
            <ThemeSwitcher />
            <LanguagePicker />
          </div>
          <div className={styles.accountGroup}>
            <Link
              to="/documentation"
              onClick={close}
              className={styles.accountRow}
            >
              {t('nav.docs')}
            </Link>
            <Link to="/whats-new" onClick={close} className={styles.accountRow}>
              {t('nav.whatsNew')}
            </Link>
            <Link to="/contact" onClick={close} className={styles.accountRow}>
              {t('nav.contact')}
            </Link>
            <Link to="/about" onClick={close} className={styles.accountRow}>
              {t('nav.about')}
            </Link>
            <Link
              to="/documentation/misc/terms-of-service"
              onClick={close}
              className={styles.accountRow}
            >
              {t('nav.terms')}
            </Link>
            <Link
              to="/documentation/misc/privacy-policy"
              onClick={close}
              className={styles.accountRow}
            >
              {t('nav.privacy')}
            </Link>
          </div>
          <div className={styles.accountGroup}>
            <a
              className={styles.accountRow}
              href="/users/logout"
              onClick={(event) => {
                close();
                onLogOut(event);
              }}
            >
              {t('nav.logout')}
            </a>
          </div>
        </dialog>
      )}
    </div>
  );
}
