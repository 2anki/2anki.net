import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../lib/i18n';
import { pinDocumentLanguage } from '../../lib/i18n/documentLanguage';
import { AppShell } from './AppShell';

function renderShell(isLoggedIn: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/documentation/start-here/upload-a-file']}
      >
        <AppShell
          isLoggedIn={isLoggedIn}
          email="someone@example.com"
          locals={{ patreon: false, subscriber: false }}
          features={{ kiUI: false, ops: false }}
        >
          <div>page</div>
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AppShell chrome language on a page pinned to English', () => {
  let release: () => void = () => {};

  beforeEach(async () => {
    await act(() => i18n.changeLanguage('ja'));
    release = pinDocumentLanguage('en');
  });

  afterEach(async () => {
    release();
    await i18n.changeLanguage('en');
  });

  it('marks the top bar navigation and footer with the app language', () => {
    renderShell(false);
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('navigation', { name: /.+/ })).toHaveAttribute(
      'lang',
      'ja'
    );
    expect(screen.getByRole('contentinfo')).toHaveAttribute('lang', 'ja');
  });

  it('marks the sidebar, top bar and skip link with the app language', () => {
    renderShell(true);
    expect(screen.getByTestId('app-sidebar')).toHaveAttribute('lang', 'ja');
    expect(screen.getByRole('banner')).toHaveAttribute('lang', 'ja');
    expect(document.querySelector('a[href="#main-content"]')).toHaveAttribute(
      'lang',
      'ja'
    );
  });

  it('marks the cookie banner with the app language', () => {
    renderShell(false);
    expect(screen.getByTestId('cookie-banner')).toHaveAttribute('lang', 'ja');
  });
});
