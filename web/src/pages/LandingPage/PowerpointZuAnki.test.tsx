import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import PowerpointZuAnki from './PowerpointZuAnki';
import powerpointZuAnkiCopy from './copy/powerpoint-zu-anki';

function renderPowerpointZuAnki() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <HelmetProvider>
          <PowerpointZuAnki setErrorMessage={vi.fn()} />
        </HelmetProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('PowerpointZuAnki', () => {
  it('renders the authored German H1 from the copy file', () => {
    renderPowerpointZuAnki();
    expect(
      screen.getByRole('heading', { level: 1, name: powerpointZuAnkiCopy.h1 })
    ).toBeInTheDocument();
  });

  it('renders every authored German FAQ question', () => {
    renderPowerpointZuAnki();
    for (const faq of powerpointZuAnkiCopy.faqs) {
      expect(screen.getByText(faq.q)).toBeInTheDocument();
    }
  });

  it('renders the med-exam framing card', () => {
    renderPowerpointZuAnki();
    expect(
      screen.getByText('Für Medizin, Pflege und Examen gebaut')
    ).toBeInTheDocument();
  });

  it('links the German related nav to the PDF German twin', () => {
    renderPowerpointZuAnki();
    expect(
      screen.getByRole('link', { name: 'Aus einem PDF Karten machen' })
    ).toHaveAttribute('href', '/pdf-zu-anki');
  });
});
