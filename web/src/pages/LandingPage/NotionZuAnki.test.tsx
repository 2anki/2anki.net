import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import NotionZuAnki from './NotionZuAnki';
import notionZuAnkiCopy from './copy/notion-zu-anki';

function renderNotionZuAnki() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <HelmetProvider>
          <NotionZuAnki setErrorMessage={vi.fn()} />
        </HelmetProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('NotionZuAnki', () => {
  it('renders the authored German H1 from the copy file', () => {
    renderNotionZuAnki();
    expect(
      screen.getByRole('heading', { level: 1, name: notionZuAnkiCopy.h1 })
    ).toBeInTheDocument();
  });

  it('renders every authored German FAQ question', () => {
    renderNotionZuAnki();
    for (const faq of notionZuAnkiCopy.faqs) {
      expect(screen.getByText(faq.q)).toBeInTheDocument();
    }
  });

  it('renders the med-exam framing card', () => {
    renderNotionZuAnki();
    expect(
      screen.getByText('Für Medizin, Pflege und Examen gebaut')
    ).toBeInTheDocument();
  });

  it('links the German related nav to other converters, not to Auto Sync', () => {
    renderNotionZuAnki();
    expect(
      screen.getByRole('link', { name: 'Alle Konverter ansehen' })
    ).toHaveAttribute('href', '/convert');
    expect(
      screen.queryByRole('link', { name: 'Automatische Synchronisierung' })
    ).not.toBeInTheDocument();
  });
});
