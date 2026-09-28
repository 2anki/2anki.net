import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import i18n from '../../lib/i18n';
import { UploadPage } from './UploadPage';

vi.mock('./components/UploadForm/UploadForm', () => ({
  default: () => <div data-testid="upload-form-stub" />,
}));

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    isError: false,
    refetch: () => {},
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/upload']}>
          <Routes>
            <Route
              path="/upload"
              element={<UploadPage setErrorMessage={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('UploadPage in German', () => {
  beforeEach(async () => {
    globalThis.sessionStorage.clear();
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the page header', () => {
    renderPage();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Konvertiere deine Notizen',
      })
    ).toBeInTheDocument();
  });

  it('translates the browser tab title', async () => {
    renderPage();
    await waitFor(() => {
      expect(document.title).toBe('Hochladen — 2anki');
    });
  });

  it('translates the how-it-works heading and the explore card', () => {
    renderPage();
    expect(screen.getByText("So funktioniert's")).toBeInTheDocument();
    expect(screen.getByText('Bessere Stapel erstellen')).toBeInTheDocument();
  });

  it('keeps protected format names untranslated in step one', () => {
    renderPage();
    expect(
      screen.getByText(
        /durchgestrichener Text auf einer Karte wird zu einem Anki-Tag/i
      )
    ).toBeInTheDocument();
  });
});
