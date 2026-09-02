import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversionResult } from './ConversionResult';
import { parseMonthlyLimitPayload } from './parseMonthlyLimitPayload';

const mockTrack = vi.fn();
vi.mock('../../../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));
vi.mock('../../../../lib/analytics/fireAnalyticsEvent', () => ({
  fireAnalyticsEvent: vi.fn(),
}));

const mockStartPassCheckout = vi.fn();
vi.mock('../../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ startPassCheckout: mockStartPassCheckout }),
}));

const mockStartUnlimitedUpgrade = vi.fn();
vi.mock('../../../../lib/backend/startUnlimitedUpgrade', () => ({
  startUnlimitedUpgrade: (...args: unknown[]) =>
    mockStartUnlimitedUpgrade(...args),
}));

vi.mock('../../hooks/useJobs', () => ({ default: vi.fn() }));

describe('parseMonthlyLimitPayload', () => {
  it('parses valid JSON with code monthly_limit', () => {
    const json = JSON.stringify({
      code: 'monthly_limit',
      cards_used: 80,
      limit: 100,
      reset_on: '2026-07-01T00:00:00.000Z',
    });
    expect(parseMonthlyLimitPayload(json)).toMatchObject({
      code: 'monthly_limit',
      cards_used: 80,
      limit: 100,
    });
  });

  it('returns null for plain text (old job format)', () => {
    expect(parseMonthlyLimitPayload('Monthly card limit reached')).toBeNull();
  });

  it('returns null for JSON with wrong code', () => {
    expect(
      parseMonthlyLimitPayload(JSON.stringify({ code: 'other' }))
    ).toBeNull();
  });

  it('returns null for null input', () => {
    expect(parseMonthlyLimitPayload(null)).toBeNull();
  });
});

describe('ConversionResult — paywalled variant', () => {
  beforeEach(() => {
    mockTrack.mockClear();
    mockStartPassCheckout.mockReset();
  });

  const renderPaywall = (
    props: Partial<{ cardsUsed: number; limit: number; resetOn?: string }> = {}
  ) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ConversionResult
            variant="paywalled"
            title="Big deck"
            limit={props.limit ?? 100}
            cardsUsed={props.cardsUsed ?? 56}
            resetOn={
              'resetOn' in props ? props.resetOn : '2026-07-01T00:00:00.000Z'
            }
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  it('shows the used-of-limit headline when cards_used is below the limit', () => {
    renderPaywall({ cardsUsed: 56, limit: 100 });
    expect(
      screen.getByText("You've used 56 of your 100 free cards this month")
    ).toBeInTheDocument();
  });

  it('shows the reached headline when cards_used is at or above the limit', () => {
    renderPaywall({ cardsUsed: 121, limit: 100 });
    expect(
      screen.getByText("You've reached your 100 free cards this month")
    ).toBeInTheDocument();
    expect(screen.queryByText(/121 of/)).toBeNull();
  });

  it('states the reset date in absolute long form when reset_on is present', () => {
    renderPaywall({ resetOn: '2026-07-01T00:00:00.000Z' });
    expect(
      screen.getByText(/Your free cards refresh on 1 July 2026/)
    ).toBeInTheDocument();
  });

  it('drops the refresh clause when reset_on is absent', () => {
    renderPaywall({ resetOn: undefined });
    expect(
      screen.getByText(/Get a pass to keep converting now/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/refresh on/)).toBeNull();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it('fires paywall_shown once with the downloads-limit surface on mount', () => {
    renderPaywall();
    expect(mockTrack).toHaveBeenCalledWith('paywall_shown', {
      surface: 'downloads-limit',
    });
  });

  it('leads with the Day Pass as the primary CTA, then Week Pass, then Unlimited', () => {
    renderPaywall();
    expect(
      screen.getByRole('button', { name: 'Get Day Pass — $6' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Get Week Pass — $12' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Upgrade to Unlimited' })
    ).toBeInTheDocument();
  });

  it('fires paywall_pass_clicked with plan=day and starts the 24h checkout', async () => {
    mockStartPassCheckout.mockResolvedValue({ status: 'error' });
    renderPaywall();
    fireEvent.click(screen.getByRole('button', { name: 'Get Day Pass — $6' }));
    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith('paywall_pass_clicked', {
        surface: 'downloads-limit',
        plan: 'day',
      });
      expect(mockStartPassCheckout).toHaveBeenCalledWith(
        '24h',
        undefined,
        'downloads-limit'
      );
    });
  });

  it('fires paywall_pass_clicked with plan=week and starts the 7d checkout', async () => {
    mockStartPassCheckout.mockResolvedValue({ status: 'error' });
    renderPaywall();
    fireEvent.click(
      screen.getByRole('button', { name: 'Get Week Pass — $12' })
    );
    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith('paywall_pass_clicked', {
        surface: 'downloads-limit',
        plan: 'week',
      });
      expect(mockStartPassCheckout).toHaveBeenCalledWith(
        '7d',
        undefined,
        'downloads-limit'
      );
    });
  });

  it('fires paywall_upgrade_clicked with plan=unlimited on the Unlimited link', () => {
    renderPaywall();
    fireEvent.click(screen.getByRole('link', { name: 'Upgrade to Unlimited' }));
    expect(mockTrack).toHaveBeenCalledWith('paywall_upgrade_clicked', {
      surface: 'downloads-limit',
      plan: 'unlimited',
    });
  });
});

describe('ConversionResult — success variant', () => {
  it('renders the card count and the clean-cards confirmation for a finished deck', () => {
    render(
      <MemoryRouter>
        <ConversionResult variant="success" count={34} />
      </MemoryRouter>
    );

    expect(screen.getByText('34')).toBeInTheDocument();
    expect(screen.getByText('cards')).toBeInTheDocument();
    expect(
      screen.getByText('No empty backs, no stray characters. Ready for Anki.')
    ).toBeInTheDocument();
  });

  it('tells the learner the cards keep the document order in Anki', () => {
    render(
      <MemoryRouter>
        <ConversionResult variant="success" count={76} />
      </MemoryRouter>
    );

    expect(
      screen.getByText("Cards keep the document's order in Anki.")
    ).toBeInTheDocument();
  });

  it('uses the singular noun for a one-card deck', () => {
    render(
      <MemoryRouter>
        <ConversionResult variant="success" count={1} />
      </MemoryRouter>
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('card')).toBeInTheDocument();
  });
});

describe('ConversionResult — failed variant', () => {
  it('renders the error message from classifyUploadError', () => {
    render(
      <MemoryRouter>
        <ConversionResult
          variant="failed"
          title="Bad deck"
          failureReason="too_large: file exceeds limit"
          source="upload"
          onMapColumns={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(
      screen.queryByRole('link', { name: 'Upgrade to Unlimited' })
    ).toBeNull();
  });

  it.each(['claude_parse_failed', 'claude_response_truncated'])(
    'renders the designer copy for %s instead of the raw identifier',
    (reason) => {
      render(
        <MemoryRouter>
          <ConversionResult
            variant="failed"
            title="Study notes"
            failureReason={reason}
            source="upload"
            onMapColumns={vi.fn()}
          />
        </MemoryRouter>
      );

      expect(screen.queryByText(new RegExp(reason))).toBeNull();
      expect(
        screen.getByText(/Something went wrong while making your cards/)
      ).toBeInTheDocument();
    }
  );

  const EMPTY_DECK_REASON =
    'No cards in this deck yet. 2anki makes a card from every Notion toggle.';

  it('teaches toggles when the empty deck came from Notion', () => {
    render(
      <MemoryRouter>
        <ConversionResult
          variant="failed"
          title="Study notes"
          failureReason={EMPTY_DECK_REASON}
          source="notion"
          onMapColumns={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/Notion toggle/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'See how toggles become cards' })
    ).toBeInTheDocument();
  });

  it.each(['upload', 'dropbox', 'drive'] as const)(
    'explains the file, not toggles, when the empty deck came from %s',
    (source) => {
      render(
        <MemoryRouter>
          <ConversionResult
            variant="failed"
            title="Study notes"
            failureReason={EMPTY_DECK_REASON}
            source={source}
            onMapColumns={vi.fn()}
          />
        </MemoryRouter>
      );

      expect(screen.queryByText(/toggle/i)).toBeNull();
      expect(
        screen.getByText(/No cards came out of this file/)
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'See supported formats' })
      ).toHaveAttribute('href', '/documentation/reference/file-formats');
    }
  );

  it('renders notion token expired reconnect link when source is notion and reason is notion_token_expired', () => {
    render(
      <MemoryRouter>
        <ConversionResult
          variant="failed"
          title="Notion page"
          failureReason="notion_token_expired"
          source="notion"
          onMapColumns={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('link', { name: 'Reconnect Notion' })
    ).toBeInTheDocument();
  });

  it('shows the toggle teaching copy and docs CTA for an empty deck without falling through to Check status', () => {
    const emptyDeckReason =
      "No cards in this deck yet. 2anki makes a card from every Notion toggle — the toggle title becomes the question, what's inside becomes the answer. Wrap your key terms in toggles, then convert again.";
    render(
      <MemoryRouter>
        <ConversionResult
          variant="failed"
          title="Empty Notion page"
          failureReason={emptyDeckReason}
          source="notion"
          onMapColumns={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(
      screen.getByText(/makes a card from every Notion toggle/i)
    ).toBeInTheDocument();
    const cta = screen.getByRole('link', {
      name: 'See how toggles become cards',
    });
    expect(cta.getAttribute('href')).toBe('/documentation/cards/notion-blocks');
    expect(screen.queryByText(/Check status/i)).toBeNull();
  });

  it('shows a subpages recovery hint when the server reports a too-large OOM failure', () => {
    const tooLargeReason =
      'This page is too large for us to convert in one go. Split it into smaller pages — or convert it section by section — and try again.';
    render(
      <MemoryRouter>
        <ConversionResult
          variant="failed"
          title="Big Notion export"
          failureReason={tooLargeReason}
          source="notion"
          onMapColumns={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(/subpage/i)).toBeInTheDocument();
  });
});
