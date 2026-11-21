import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import i18n from '../../lib/i18n';
import LandingPage from './LandingPage';
import pdfCopy from './copy/pdf';
import pdfZuAnkiCopy from './copy/pdf-zu-anki';
import type { LandingCopy } from './types';
import { CONVERT_LANDING_PAGES } from '../ConvertLandingPage/convertLandingConfig';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

function renderLanding(copy: LandingCopy) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <HelmetProvider>
          <LandingPage copy={copy} setErrorMessage={vi.fn()} />
        </HelmetProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function langOf(element: Element | null): string | null {
  return element?.closest('[lang]')?.getAttribute('lang') ?? null;
}

describe('LandingPage block languages under a Japanese app', () => {
  beforeEach(async () => {
    await act(() => i18n.changeLanguage('ja'));
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('marks the translated hero heading with the app language', () => {
    renderLanding(pdfCopy);
    expect(langOf(screen.getByRole('heading', { level: 1 }))).toBe('ja');
  });

  it('marks the English questions, related links and Anki notes as English', () => {
    renderLanding(pdfCopy);
    expect(langOf(screen.getByText(pdfCopy.faqs[0].q))).toBe('en');
    const related = pdfCopy.relatedLinks?.[0];
    expect(langOf(screen.getByText(related?.label ?? ''))).toBe('en');
    const note = pdfCopy.whatComesAcross?.[0];
    expect(langOf(screen.getByText(note?.title ?? ''))).toBe('en');
  });

  it('marks an untranslated hero heading as English', () => {
    const excel = CONVERT_LANDING_PAGES.get('excel-to-anki') as LandingCopy;
    renderLanding(excel);
    expect(
      langOf(screen.getByRole('heading', { level: 1, name: excel.h1 }))
    ).toBe('en');
  });

  it('marks the German copy of a German landing page as German', () => {
    renderLanding(pdfZuAnkiCopy);
    expect(langOf(screen.getByText(pdfZuAnkiCopy.faqs[0].q))).toBe('de');
    expect(
      langOf(screen.getByRole('heading', { level: 1, name: pdfZuAnkiCopy.h1 }))
    ).toBe('de');
  });
});
