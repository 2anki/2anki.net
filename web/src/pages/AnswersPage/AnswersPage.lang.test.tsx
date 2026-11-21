import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../lib/i18n';
import AnswersPage from './AnswersPage';
import { ANSWERS_PAGES } from './answersConfig';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

function renderAtSlug(slug: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <HelmetProvider>
        <MemoryRouter initialEntries={[`/answers/${slug}`]}>
          <Routes>
            <Route
              path="/answers/:slug"
              element={<AnswersPage setErrorMessage={vi.fn()} />}
            />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    </QueryClientProvider>
  );
}

function langOf(element: Element | null): string | null {
  return element?.closest('[lang]')?.getAttribute('lang') ?? null;
}

describe('AnswersPage block languages under a Japanese app', () => {
  beforeEach(async () => {
    await act(() => i18n.changeLanguage('ja'));
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('marks the English sections, questions and related links as English', () => {
    const config = ANSWERS_PAGES.get('word-to-anki');
    renderAtSlug('word-to-anki');
    expect(langOf(screen.getByText(config?.sections[0].heading ?? ''))).toBe(
      'en'
    );
    const faq = config?.faqs?.[0];
    expect(langOf(screen.getByText(faq?.q ?? ''))).toBe('en');
    const related = config?.relatedLinks[0];
    expect(langOf(screen.getByText(related?.label ?? ''))).toBe('en');
  });

  it('keeps the translated heading on the app language', () => {
    renderAtSlug('pdf-to-anki');
    expect(langOf(screen.getByRole('heading', { level: 1 }))).toBe('ja');
  });

  it('marks an untranslated heading and upload prompt as English', () => {
    const config = ANSWERS_PAGES.get('chatgpt-to-anki');
    renderAtSlug('chatgpt-to-anki');
    expect(
      langOf(screen.getByRole('heading', { level: 1, name: config?.h1 }))
    ).toBe('en');
    expect(
      langOf(screen.getByRole('heading', { name: config?.uploadPrompt }))
    ).toBe('en');
  });
});
