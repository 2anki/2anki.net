import { render, screen, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';
import { vi } from 'vitest';

import { HomePage } from './HomePage';

const trackMock = vi.fn();
vi.mock('../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

function renderHome(isLoggedIn = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage setErrorMessage={vi.fn()} isLoggedIn={isLoggedIn} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const HOME_CSS = readFileSync(join(__dirname, 'HomePage.module.css'), 'utf8');

interface GridRule {
  readonly media: string | null;
  readonly columns: number;
}

function columnsIn(declarations: string): number | null {
  const match = /grid-template-columns:\s*([^;]+);/.exec(declarations);
  if (match == null) return null;
  const repeat = /^repeat\((\d+),/.exec(match[1].trim());
  return repeat == null ? 1 : Number(repeat[1]);
}

function featureGridRules(css: string): GridRule[] {
  const rules: GridRule[] = [];
  const mediaBlock = /@media\s*\(([^)]*)\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g;
  const gridRule = /\.featuresGrid\s*\{([^}]*)\}/g;
  const outside = css.replace(mediaBlock, '');
  for (const [, body] of outside.matchAll(gridRule)) {
    const columns = columnsIn(body);
    if (columns != null) rules.push({ media: null, columns });
  }
  for (const [, media, block] of css.matchAll(mediaBlock)) {
    for (const [, body] of block.matchAll(gridRule)) {
      const columns = columnsIn(body);
      if (columns != null) rules.push({ media, columns });
    }
  }
  return rules;
}

function mediaApplies(media: string | null, viewportWidth: number): boolean {
  if (media == null) return true;
  const [, kind, px] = /(max|min)-width:\s*(\d+)px/.exec(media) ?? [];
  return kind === 'max'
    ? viewportWidth <= Number(px)
    : viewportWidth >= Number(px);
}

function featureGridColumnsAt(viewportWidth: number): number {
  const applying = featureGridRules(HOME_CSS).filter((rule) =>
    mediaApplies(rule.media, viewportWidth)
  );
  if (applying.length === 0) throw new Error('no featuresGrid columns found');
  return applying[applying.length - 1].columns;
}

describe('HomePage feature grid', () => {
  it.each([
    [375, 1],
    [768, 2],
    [1000, 2],
    [1024, 2],
    [1079, 2],
    [1080, 4],
    [1440, 4],
  ])(
    'fills every row at %spx, with %s columns and no orphan tile',
    (width, expectedColumns) => {
      renderHome();
      const section = screen
        .getByRole('heading', { name: 'Other ways to use 2anki' })
        .closest('section');
      if (section == null) throw new Error('feature section not found');
      const tiles = within(section).getAllByRole('link');

      expect(tiles).toHaveLength(8);
      expect(featureGridColumnsAt(width)).toBe(expectedColumns);
      expect(tiles.length % featureGridColumnsAt(width)).toBe(0);
    }
  );
});

describe('HomePage (anonymous)', () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  it('fires landing_page_viewed once on mount tagged with the home path', () => {
    renderHome();
    expect(
      trackMock.mock.calls.filter(([name]) => name === 'landing_page_viewed')
    ).toEqual([['landing_page_viewed', { path: '/' }]]);
  });

  it('does not also fire the separate AI badge impression on the landing page', () => {
    renderHome();
    expect(
      trackMock.mock.calls.filter(
        ([name]) => name === 'home_ai_anon_badge_viewed'
      )
    ).toHaveLength(0);
  });

  it('does not fire landing_page_viewed for a logged-in visitor', () => {
    renderHome(true);
    expect(trackMock).not.toHaveBeenCalledWith('landing_page_viewed');
  });

  it('renders the mascot as a brand mark', () => {
    renderHome();
    const mascot = document.querySelector('img[src*="mascot"]');
    expect(mascot).toBeInTheDocument();
  });

  it('renders the primary h1', () => {
    renderHome();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /flashcards that work in anki/i,
      })
    ).toBeInTheDocument();
  });

  it('renders the upload form drop zone', () => {
    renderHome();
    expect(screen.getByText(/drop your files here/i)).toBeInTheDocument();
  });

  it('offers a Try a sample action in the hero for visitors with no file', () => {
    renderHome();
    expect(screen.getByText('No file yet?')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Try a sample' })
    ).toBeInTheDocument();
  });

  it('keeps the hero focused on conversion — no free-tier limit or open-source brag in the hero', () => {
    renderHome();
    expect(screen.queryByText(/100 cards per month/i)).toBeNull();
    expect(screen.queryByText(/open source/i)).toBeNull();
  });

  it('leads the hero badge with clean-card output and keeps AI as a quiet opt-in', () => {
    renderHome();
    expect(
      screen.getByText(/Clean cards, ready to study/i)
    ).toBeInTheDocument();
    const link = screen.getByRole('link', {
      name: /create an account/i,
    });
    expect(link).toHaveAttribute('href', '/register?redirect=/card-options');
  });

  it('loads /register as a full page from the hero badge so a provider sign-up returns to /card-options', () => {
    renderHome();
    const link = screen.getByRole('link', { name: /create an account/i });
    expect(fireEvent.click(link)).toBe(true);
  });

  it('links to card options above the upload form so anon visitors can configure first', () => {
    renderHome();
    const link = screen.getByRole('link', { name: 'Card options' });
    expect(link).toHaveAttribute('href', '/card-options');
  });

  it('lists popular conversions linking the Notion pillar, PDF, and the hub', () => {
    renderHome();
    expect(
      screen.getByRole('link', { name: 'Convert Notion to Anki' })
    ).toHaveAttribute('href', '/notion-to-anki');
    expect(
      screen.getByRole('link', { name: 'Convert a PDF to Anki' })
    ).toHaveAttribute('href', '/pdf-to-anki');
    expect(
      screen.getByRole('link', { name: 'Browse every converter' })
    ).toHaveAttribute('href', '/convert');
  });

  it('lists no Auto Sync feature, since the plan is not on sale', () => {
    renderHome();
    expect(
      screen.getByRole('heading', { name: 'Other ways to use 2anki' })
    ).toBeInTheDocument();
    expect(document.querySelector('a[href="/ankify"]')).toBeNull();
    expect(screen.queryByText('Auto Sync')).not.toBeInTheDocument();
  });

  it('renders the three how-it-works steps with icons', () => {
    renderHome();
    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Convert')).toBeInTheDocument();
    expect(screen.getByText('Study')).toBeInTheDocument();
    const svgs = document.querySelectorAll('svg[viewBox="0 0 24 24"]');
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  });

  it('renders 3 walkthrough play buttons by default', () => {
    renderHome();
    const playButtons = screen.getAllByRole('button', { name: /play:/i });
    expect(playButtons.length).toBe(3);
  });

  it('renders all 10 walkthrough play buttons after clicking expand', () => {
    renderHome();
    const expandButton = screen.getByRole('button', {
      name: /show all 10 videos/i,
    });
    fireEvent.click(expandButton);
    const playButtons = screen.getAllByRole('button', { name: /play:/i });
    expect(playButtons.length).toBe(10);
  });
});
