import React, { ReactNode, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sidebar, SidebarFeatures, SidebarLocals } from './Sidebar';
import { MobileTopBar } from './MobileTopBar';
import { SkeletonPage } from '../Skeleton/Skeleton';
import { ErrorPresenter } from '../errors/ErrorPresenter';
import { AccessBanner } from '../AccessBanner/AccessBanner';
import sharedStyles from '../../styles/shared.module.css';
import styles from './AppShell.module.css';

interface SidebarLayoutProps {
  email: string | null | undefined;
  locals: SidebarLocals | undefined | null;
  features: SidebarFeatures | undefined | null;
  onLogOut: (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => void;
  error?: Error | null;
  children: ReactNode;
}

export function SidebarLayout({
  email,
  locals,
  features,
  onLogOut,
  error,
  children,
}: Readonly<SidebarLayoutProps>) {
  const { t } = useTranslation('chrome');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isDrawerOpen]);

  return (
    <div className={styles.shell} data-shell>
      <a href="#main-content" className={styles.skipLink}>
        {t('nav.skipToContent')}
      </a>
      <Sidebar
        email={email}
        locals={locals}
        features={features}
        onLogOut={onLogOut}
        onNavigate={() => setIsDrawerOpen(false)}
        isOpen={isDrawerOpen}
        drawerId="app-sidebar-drawer"
      />
      <button
        type="button"
        data-testid="sidebar-backdrop"
        aria-hidden={!isDrawerOpen}
        tabIndex={-1}
        className={isDrawerOpen ? styles.backdropVisible : styles.backdrop}
        onClick={() => setIsDrawerOpen(false)}
      />
      <div className={styles.main}>
        <MobileTopBar
          isOpen={isDrawerOpen}
          onOpen={() => setIsDrawerOpen(true)}
          onClose={() => setIsDrawerOpen(false)}
        />
        <AccessBanner
          passExpiresAt={locals?.passExpiresAt}
          passKind={locals?.passKind}
        />
        {error && <ErrorPresenter error={error} />}
        <main id="main-content" className={sharedStyles.flexGrow}>
          <Suspense fallback={<SkeletonPage rows={5} />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}
