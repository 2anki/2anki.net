import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../lib/hooks/useTheme';
import { AccountMenu } from './AccountMenu';
import type { SidebarLocals } from './Sidebar';
import styles from './AppShell.module.css';

interface TopBarProps {
  email: string | null | undefined;
  locals: SidebarLocals | undefined | null;
  onLogOut: (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => void;
  isDrawerOpen: boolean;
  onOpenDrawer: () => void;
  onCloseDrawer: () => void;
}

export function TopBar({
  email,
  locals,
  onLogOut,
  isDrawerOpen,
  onOpenDrawer,
  onCloseDrawer,
}: Readonly<TopBarProps>) {
  const { t } = useTranslation('chrome');
  const onBurgerClick = isDrawerOpen ? onCloseDrawer : onOpenDrawer;
  const theme = useTheme();
  const logoSrc =
    theme === 'light' ? '/mascot/navbar-logo.png' : '/mascot/Notion 1.png';
  return (
    <header className={styles.topBar}>
      <button
        type="button"
        className={styles.mobileBurger}
        aria-label={t('nav.openNavigation')}
        aria-expanded={isDrawerOpen}
        aria-controls="app-sidebar-drawer"
        onClick={onBurgerClick}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      <a className={styles.mobileLogo} href="/" aria-label={t('nav.home')}>
        <img src={logoSrc} alt="" />
      </a>
      <div className={styles.topBarEnd}>
        <AccountMenu email={email} locals={locals} onLogOut={onLogOut} />
      </div>
    </header>
  );
}
