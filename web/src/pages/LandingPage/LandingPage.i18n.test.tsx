import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import i18n from '../../lib/i18n';
import LandingPage from './LandingPage';
import usmleCopy from './copy/usmle';

function renderLandingPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <HelmetProvider>
          <LandingPage copy={usmleCopy} setErrorMessage={vi.fn()} />
        </HelmetProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('LandingPage in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the per-page hero heading in German', () => {
    renderLandingPage();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'USMLE-Step-1- und Step-2-Stapel aus deinen eigenen Notizen',
      })
    ).toBeInTheDocument();
  });

  it('translates the shared how-it-works label', () => {
    renderLandingPage();
    expect(screen.getByText("So funktioniert's")).toBeInTheDocument();
  });

  it('leaves the html lang on the app language for a page without its own language', () => {
    renderLandingPage();
    expect(document.documentElement.lang).toBe('de');
  });

  it('translates the secondary sign-up link', () => {
    renderLandingPage();
    expect(
      screen.getByRole('link', { name: 'kostenlos registrieren' })
    ).toBeInTheDocument();
  });
});
