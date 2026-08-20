import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../lib/hooks/useTheme';
import { useCardUsage } from '../../lib/hooks/useCardUsage';
import {
  getPlanLabel,
  isPayingUser,
} from '../NavigationBar/helpers/getPlanLabel';
import ArrowLeftIcon from '../icons/ArrowLeftIcon';
import ArrowRightIcon from '../icons/ArrowRightIcon';
import ArrowRightOnRectangleIcon from '../icons/ArrowRightOnRectangleIcon';
import ArrowUpTrayIcon from '../icons/ArrowUpTrayIcon';
import BookOpenIcon from '../icons/BookOpenIcon';
import ChatBubbleIcon from '../icons/ChatBubbleIcon';
import CameraIcon from '../icons/CameraIcon';
import RectangleGroupIcon from '../icons/RectangleGroupIcon';
import SwatchIcon from '../icons/SwatchIcon';
import LayersIcon from '../icons/LayersIcon';
import ChevronRightIcon from '../icons/ChevronRightIcon';
import CommandLineIcon from '../icons/CommandLineIcon';
import CreditCardIcon from '../icons/CreditCardIcon';
import PrinterIcon from '../icons/PrinterIcon';
import SparklesIcon from '../icons/SparklesIcon';
import StarIcon from '../icons/StarIcon';
import UserCircleIcon from '../icons/UserCircleIcon';
import SettingsIcon from '../icons/SettingsIcon';
import WrenchIcon from '../icons/WrenchIcon';
import ShareIcon from '../icons/ShareIcon';
import { OPS_TABS } from '../../pages/OpsPage/opsTabs';
import { ThemeSwitcher } from '../ThemeSwitcher/ThemeSwitcher';
import { ThemeToggle } from '../ThemeSwitcher/ThemeToggle';
import { LanguagePicker } from '../LanguagePicker/LanguagePicker';
import styles from './AppShell.module.css';
import { useSidebarCollapseState } from './useSidebarCollapseState';

interface CardUsageCounterProps {
  used: number;
  limit: number;
}

function CardUsageCounter({ used, limit }: Readonly<CardUsageCounterProps>) {
  const atLimit = used >= limit;
  const approaching = !atLimit && used >= limit * 0.8;
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
      <span className={restClass}> / {limit} cards this month</span>
      {atLimit && (
        <Link to="/pricing?from=limit" className={styles.identityUsageUpgrade}>
          Upgrade for unlimited
        </Link>
      )}
    </span>
  );
}

export interface SidebarLocals {
  patreon?: boolean;
  subscriber?: boolean;
  autoSyncActive?: boolean;
  passExpiresAt?: string | null;
  passKind?: '24h' | '7d' | 'unlimited' | null;
}

export interface SidebarFeatures {
  kiUI?: boolean;
  ops?: boolean;
}

interface SidebarProps {
  email: string | null | undefined;
  locals: SidebarLocals | undefined | null;
  features: SidebarFeatures | undefined | null;
  onLogOut: (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => void;
  onNavigate?: () => void;
  isOpen?: boolean;
  drawerId?: string;
}

interface SidebarRowProps {
  href: string;
  pathname: string;
  matchPrefix?: boolean;
  active?: boolean;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  icon?: React.ComponentType<{ width?: number; height?: number }>;
  children: React.ReactNode;
}

function isActiveRoute(pathname: string, href: string, matchPrefix: boolean) {
  if (pathname === href) return true;
  if (!matchPrefix) return false;
  return pathname.startsWith(`${href}/`);
}

function SidebarRow({
  href,
  pathname,
  matchPrefix = true,
  active: activeOverride,
  onClick,
  icon: Icon,
  children,
}: Readonly<SidebarRowProps>) {
  const active = activeOverride ?? isActiveRoute(pathname, href, matchPrefix);
  const label = typeof children === 'string' ? children : undefined;
  return (
    <Link
      to={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={`${styles.sidebarRow} ${
        active ? styles.sidebarRowActive : ''
      }`}
    >
      {Icon && <Icon width={20} height={20} />}
      <span className={styles.sidebarRowLabel}>{children}</span>
    </Link>
  );
}

interface OpsSidebarFolderProps {
  pathname: string;
  collapsed: boolean;
  onNavigate: React.MouseEventHandler<HTMLAnchorElement>;
}

function OpsSidebarFolder({
  pathname,
  collapsed,
  onNavigate,
}: Readonly<OpsSidebarFolderProps>) {
  const opsActive = pathname === '/ops' || pathname.startsWith('/ops/');
  const [open, setOpen] = useState(opsActive);
  const expanded = open || opsActive;

  if (collapsed) {
    return (
      <SidebarRow
        href="/ops"
        pathname={pathname}
        matchPrefix
        onClick={onNavigate}
        icon={WrenchIcon}
      >
        Ops
      </SidebarRow>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.sidebarRow} ${styles.sidebarFolderHeader}`}
        aria-expanded={expanded}
        aria-controls="ops-folder-items"
        onClick={() => setOpen((value) => !value)}
      >
        <WrenchIcon width={20} height={20} />
        <span className={styles.sidebarRowLabel}>Ops</span>
        <ChevronRightIcon
          width={16}
          height={16}
          className={`${styles.sidebarFolderChevron} ${
            expanded ? styles.sidebarFolderChevronOpen : ''
          }`}
        />
      </button>
      {expanded && (
        <div
          id="ops-folder-items"
          role="group"
          aria-label="Ops"
          className={styles.sidebarFolderItems}
        >
          {OPS_TABS.map((tab) => (
            <SidebarRow
              key={tab.to}
              href={tab.to}
              pathname={pathname}
              active={tab.match(pathname)}
              onClick={onNavigate}
            >
              {tab.label}
            </SidebarRow>
          ))}
        </div>
      )}
    </>
  );
}

function getLogoSrc(collapsed: boolean, theme: string): string {
  if (collapsed) return '/mascot/Notion 1.png';
  if (theme === 'light') return '/mascot/navbar-logo.png';
  return '/mascot/Notion 1.png';
}

export function Sidebar({
  email,
  locals,
  features,
  onLogOut,
  onNavigate,
  isOpen = false,
  drawerId,
}: Readonly<SidebarProps>) {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const theme = useTheme();
  const { collapsed, onToggleClick, onSidebarInteraction } =
    useSidebarCollapseState(pathname);
  const logoSrc = getLogoSrc(collapsed, theme);
  const showAnkify =
    locals?.patreon === true || locals?.autoSyncActive === true;
  const isLoggedIn = locals != null;
  const showFavorites = email != null && email !== '';
  const paying = isPayingUser(locals);
  const showPricing = !paying;
  const showKi = features?.kiUI === true;
  const showOps = features?.ops === true;
  const showAdminGroup = showKi || showOps;
  const planLabel = getPlanLabel(locals);
  const usage = useCardUsage(isLoggedIn && !paying);
  const showUsage = usage != null && !usage.unlimited && !usage.loading;

  const handleNavClick = (
    handler?: React.MouseEventHandler<HTMLAnchorElement>
  ): React.MouseEventHandler<HTMLAnchorElement> => {
    return (event) => {
      onNavigate?.();
      handler?.(event);
    };
  };

  return (
    <>
      <aside
        id={drawerId}
        className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''} ${collapsed ? styles.sidebarCollapsed : ''}`}
        aria-label="Main navigation"
        data-testid="app-sidebar"
        data-collapsed={collapsed ? 'true' : 'false'}
        onMouseEnter={onSidebarInteraction}
        onFocus={onSidebarInteraction}
      >
        <div className={styles.sidebarHeader}>
          <Link
            className={styles.sidebarLogo}
            to="/"
            aria-label="2anki home"
            onClick={handleNavClick()}
          >
            <img src={logoSrc} alt="" />
          </Link>
        </div>
        <nav className={styles.sidebarNav}>
          <div className={styles.sidebarGroup}>
            <SidebarRow
              href="/upload"
              pathname={pathname}
              matchPrefix={false}
              onClick={handleNavClick()}
              icon={ArrowUpTrayIcon}
            >
              {t('nav.makeFlashcards')}
            </SidebarRow>
            <SidebarRow
              href="/notion"
              pathname={pathname}
              onClick={handleNavClick()}
              icon={ArrowRightIcon}
            >
              {t('nav.notionToAnki')}
            </SidebarRow>
            <SidebarRow
              href="/templates"
              pathname={pathname}
              matchPrefix={false}
              onClick={handleNavClick()}
              icon={SwatchIcon}
            >
              {t('nav.noteTypes')}
            </SidebarRow>
            <SidebarRow
              href="/print"
              pathname={pathname}
              matchPrefix={false}
              onClick={handleNavClick()}
              icon={PrinterIcon}
            >
              {t('nav.print')}
            </SidebarRow>
            <SidebarRow
              href="/chat"
              pathname={pathname}
              matchPrefix={false}
              onClick={handleNavClick()}
              icon={ChatBubbleIcon}
            >
              {t('nav.chat')}
            </SidebarRow>
            <SidebarRow
              href="/mindmaps"
              pathname={pathname}
              onClick={handleNavClick()}
              icon={ShareIcon}
            >
              {t('nav.mindMaps')}
            </SidebarRow>
            <SidebarRow
              href="/image-occlusion"
              pathname={pathname}
              matchPrefix={false}
              onClick={handleNavClick()}
              icon={RectangleGroupIcon}
            >
              {t('nav.imageOcclusion')}
            </SidebarRow>
            <SidebarRow
              href="/photo-to-deck"
              pathname={pathname}
              matchPrefix={false}
              onClick={handleNavClick()}
              icon={CameraIcon}
            >
              {t('nav.photoToDeck')}
            </SidebarRow>
            <SidebarRow
              href="/import"
              pathname={pathname}
              matchPrefix={false}
              onClick={handleNavClick()}
              icon={ArrowLeftIcon}
            >
              {t('nav.ankiToNotion')}
            </SidebarRow>
            {showAnkify && (
              <SidebarRow
                href="/ankify"
                pathname={pathname}
                onClick={handleNavClick()}
                icon={SparklesIcon}
              >
                {t('nav.autoSync')}
              </SidebarRow>
            )}
          </div>
          <div className={styles.sidebarGroup}>
            <p className={styles.sidebarGroupLabel}>{t('nav.library')}</p>
            <SidebarRow
              href="/downloads"
              pathname={pathname}
              onClick={handleNavClick()}
              icon={LayersIcon}
            >
              {t('nav.myDecks')}
            </SidebarRow>
            {showFavorites && (
              <SidebarRow
                href="/favorites"
                pathname={pathname}
                matchPrefix={false}
                onClick={handleNavClick()}
                icon={StarIcon}
              >
                {t('nav.favorites')}
              </SidebarRow>
            )}
            <SidebarRow
              href="/card-options"
              pathname={pathname}
              matchPrefix={false}
              onClick={handleNavClick()}
              icon={SettingsIcon}
            >
              {t('nav.settings')}
            </SidebarRow>
          </div>
          <div className={styles.sidebarGroup}>
            <p className={styles.sidebarGroupLabel}>{t('nav.resources')}</p>
            <SidebarRow
              href="/documentation"
              pathname={pathname}
              onClick={handleNavClick()}
              icon={BookOpenIcon}
            >
              {t('nav.docs')}
            </SidebarRow>
            {showPricing && (
              <SidebarRow
                href="/pricing"
                pathname={pathname}
                matchPrefix={false}
                onClick={handleNavClick()}
                icon={CreditCardIcon}
              >
                {t('nav.pricing')}
              </SidebarRow>
            )}
          </div>
          {showAdminGroup && (
            <div className={styles.sidebarGroup}>
              {showKi && (
                <SidebarRow
                  href="/ki"
                  pathname={pathname}
                  onClick={handleNavClick()}
                  icon={CommandLineIcon}
                >
                  KI
                </SidebarRow>
              )}
              {showOps && (
                <OpsSidebarFolder
                  pathname={pathname}
                  collapsed={collapsed}
                  onNavigate={handleNavClick()}
                />
              )}
            </div>
          )}
        </nav>
        <div className={styles.sidebarTheme}>
          {collapsed ? <ThemeToggle /> : <ThemeSwitcher />}
          <LanguagePicker />
          {!collapsed && (
            <Link
              to="/whats-new"
              onClick={handleNavClick()}
              className={styles.whatsNewLink}
            >
              {t('nav.whatsNew')}
            </Link>
          )}
        </div>
        <div className={styles.sidebarSpacer} />
        <div className={styles.identity}>
          <span className={styles.identityEmail} title={email ?? undefined}>
            {email ?? 'Account'}
          </span>
          <span className={styles.identityPlan}>{planLabel}</span>
          {showUsage && usage && (
            <CardUsageCounter
              used={usage.cards_used}
              limit={usage.cards_limit}
            />
          )}
        </div>
        <div className={styles.sidebarGroup}>
          <SidebarRow
            href="/account"
            pathname={pathname}
            matchPrefix={false}
            onClick={handleNavClick()}
            icon={UserCircleIcon}
          >
            {t('nav.account')}
          </SidebarRow>
          <a
            className={styles.sidebarRow}
            href="/users/logout"
            onClick={handleNavClick(onLogOut)}
            title={t('nav.logout')}
          >
            <ArrowRightOnRectangleIcon width={20} height={20} />
            <span className={styles.sidebarRowLabel}>{t('nav.logout')}</span>
          </a>
        </div>
        <div className={styles.sidebarMore}>
          <div className={styles.sidebarMoreLinks}>
            <Link to="/contact" onClick={handleNavClick()}>
              {t('nav.contact')}
            </Link>
            <Link
              to="/documentation/misc/privacy-policy"
              onClick={handleNavClick()}
            >
              {t('nav.privacy')}
            </Link>
            <Link
              to="/documentation/misc/terms-of-service"
              onClick={handleNavClick()}
            >
              {t('nav.terms')}
            </Link>
            <Link to="/about" onClick={handleNavClick()}>
              {t('nav.about')}
            </Link>
          </div>
        </div>
      </aside>
      <button
        type="button"
        onClick={onToggleClick}
        className={`${styles.collapseRail} ${
          collapsed ? styles.collapseRailCollapsed : ''
        }`}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
      >
        <span className={styles.collapseRailLine} aria-hidden="true" />
        <span className={styles.collapseRailContent} aria-hidden="true">
          {collapsed ? (
            <ArrowRightIcon width={16} height={16} />
          ) : (
            <ArrowLeftIcon width={16} height={16} />
          )}
          <span>{collapsed ? 'Expand' : 'Collapse'}</span>
        </span>
      </button>
    </>
  );
}
