import React, { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { get2ankiApi } from '../../lib/backend/get2ankiApi';
import { PageLayout } from '../Layout/PageLayout';
import { SidebarFeatures, SidebarLocals } from './Sidebar';
import { SidebarLayout } from './SidebarLayout';
import { CookieBanner } from '../CookieBanner/CookieBanner';

const TOP_BAR_PATHS = new Set(['/login', '/register', '/forgot']);
const TOP_BAR_PREFIXES = ['/users/r/'];

function shouldForceTopBar(pathname: string): boolean {
  if (TOP_BAR_PATHS.has(pathname)) return true;
  return TOP_BAR_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

interface AppShellProps {
  isLoggedIn: boolean | undefined;
  email: string | null | undefined;
  locals: SidebarLocals | undefined | null;
  features: SidebarFeatures | undefined | null;
  error?: Error | null;
  children: ReactNode;
}

export function AppShell({
  isLoggedIn,
  email,
  locals,
  features,
  error,
  children,
}: Readonly<AppShellProps>) {
  const { pathname } = useLocation();

  const onLogOut = (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
    event.preventDefault();
    get2ankiApi().logout();
  };

  const useSidebar = isLoggedIn === true && !shouldForceTopBar(pathname);

  if (useSidebar) {
    return (
      <SidebarLayout
        email={email}
        locals={locals}
        features={features}
        onLogOut={onLogOut}
        error={error}
      >
        <CookieBanner />
        {children}
      </SidebarLayout>
    );
  }

  return (
    <PageLayout error={error} isLoggedIn={isLoggedIn}>
      <CookieBanner />
      {children}
    </PageLayout>
  );
}
