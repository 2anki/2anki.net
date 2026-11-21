import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import PdfZuAnki from './PdfZuAnki';
import pdfZuAnkiCopy from './copy/pdf-zu-anki';

function renderPdfZuAnki() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <HelmetProvider>
          <PdfZuAnki setErrorMessage={vi.fn()} />
        </HelmetProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('PdfZuAnki', () => {
  it('renders the authored German H1 from the copy file', () => {
    renderPdfZuAnki();
    expect(
      screen.getByRole('heading', { level: 1, name: pdfZuAnkiCopy.h1 })
    ).toBeInTheDocument();
  });

  it('renders every authored German FAQ question', () => {
    renderPdfZuAnki();
    for (const faq of pdfZuAnkiCopy.faqs) {
      expect(screen.getByText(faq.q)).toBeInTheDocument();
    }
  });

  it('renders the med-exam framing card', () => {
    renderPdfZuAnki();
    expect(
      screen.getByText('Für Medizin, Pflege und Examen gebaut')
    ).toBeInTheDocument();
  });

  it('links the German related nav to the PowerPoint German twin', () => {
    renderPdfZuAnki();
    expect(
      screen.getByRole('link', { name: 'Aus PowerPoint-Folien Karten machen' })
    ).toHaveAttribute('href', '/powerpoint-zu-anki');
  });
});
