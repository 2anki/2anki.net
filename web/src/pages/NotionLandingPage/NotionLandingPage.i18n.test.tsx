import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18n from '../../lib/i18n';
import { NotionLandingPage } from './NotionLandingPage';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HelmetProvider>
        <MemoryRouter>
          <NotionLandingPage />
        </MemoryRouter>
      </HelmetProvider>
    </QueryClientProvider>
  );
}

describe('NotionLandingPage in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the hero headline in German', () => {
    renderPage();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Deine Notion-Notizen werden zu Anki-Karten',
      })
    ).toBeInTheDocument();
  });

  it('translates the connect action', () => {
    renderPage();
    expect(
      screen.getByRole('link', { name: 'Notion verbinden' })
    ).toBeInTheDocument();
  });

  it('keeps the Day Pass plan name', () => {
    renderPage();
    expect(screen.getByText('Day Pass')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Day Pass holen' })
    ).toBeInTheDocument();
  });
});

const LOCALES = [
  'en',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'nl',
  'pl',
  'pt',
  'ru',
] as const;

const AUTOMATIC_SYNC = /automat|自動|автомат|sync|sincron|同期|синхрон/i;

function notionLandingMeta(locale: string): {
  metaTitle: string;
  metaDescription: string;
} {
  const raw = readFileSync(
    join(__dirname, '../../lib/i18n/locales', locale, 'marketing.json'),
    'utf8'
  );
  return (
    JSON.parse(raw) as {
      notionLanding: { metaTitle: string; metaDescription: string };
    }
  ).notionLanding;
}

describe('NotionLandingPage meta while Auto Sync is not on sale', () => {
  const english = notionLandingMeta('en');

  it.each(LOCALES)(
    '%s promises no automatic sync in the title or description',
    (locale) => {
      const meta = notionLandingMeta(locale);

      expect(meta.metaTitle).not.toMatch(AUTOMATIC_SYNC);
      expect(meta.metaDescription).not.toMatch(AUTOMATIC_SYNC);
    }
  );

  it.each(LOCALES.filter((locale) => locale !== 'en'))(
    '%s translates the title rather than copying English',
    (locale) => {
      expect(notionLandingMeta(locale).metaTitle).not.toBe(english.metaTitle);
    }
  );
});
