import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import NotionSubscriptions from './NotionSubscriptions';
import { Backend } from '../../../lib/backend/Backend';
import { track } from '../../../lib/analytics/track';

vi.mock('../../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

type Subscription = Awaited<
  ReturnType<Backend['listAnkifySubscriptions']>
>[number];
type Schedule = Awaited<ReturnType<Backend['getAnkifyExportSchedule']>>;

const sampleSubscription = (
  overrides: Partial<Subscription> = {}
): Subscription => ({
  id: 1,
  notion_page_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  notion_page_title: 'My deck',
  notion_page_url: 'https://notion.so/My-deck',
  notion_page_icon: null,
  target_deck: null,
  enabled: true,
  last_polled_at: null,
  last_synced_at: new Date().toISOString(),
  last_error: null,
  ...overrides,
});

const sampleSchedule = (
  overrides: Partial<NonNullable<Schedule>> = {}
): Schedule => ({
  id: 10,
  owner: 42,
  database_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  time_of_day: '09:15',
  timezone: 'UTC',
  date_range_days: null,
  enabled: true,
  last_run_at: null,
  ...overrides,
});

const makeBackend = (overrides: Partial<Backend> = {}): Backend =>
  ({
    listAnkifySubscriptions: vi.fn(async () => []),
    deleteAnkifySubscription: vi.fn(),
    subscribeAnkifyNotionPage: vi.fn(),
    searchTopLevelPages: vi.fn(async () => []),
    getAnkifyStats: vi.fn(async () => ({ connected: false }) as const),
    getAnkifyDeckMaturity: vi.fn(async () => ({ connected: false }) as const),
    openAnkifyDeckInAnki: vi.fn(async () => ({ opened: true })),
    ...overrides,
  }) as unknown as Backend;

const renderSubs = (backend: Backend, schedule: Schedule = null) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <NotionSubscriptions backend={backend} schedule={schedule} />
      </QueryClientProvider>
    </MemoryRouter>
  );
};

describe('NotionSubscriptions sync copy', () => {
  test('renders the page-level helper exactly once above the deck list', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 1, notion_page_id: 'a'.repeat(32) }),
        sampleSubscription({ id: 2, notion_page_id: 'b'.repeat(32) }),
        sampleSubscription({ id: 3, notion_page_id: 'c'.repeat(32) }),
      ]),
    });

    renderSubs(backend);

    await waitFor(() => {
      const matches = screen.getAllByText(
        /checks notion for changes every 5 minutes\./i
      );
      expect(matches).toHaveLength(1);
    });
  });

  test('does not render the helper when there are no decks', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => []),
    });

    renderSubs(backend);

    await waitFor(() =>
      expect(
        screen.getByLabelText(/search your notion pages/i)
      ).toBeInTheDocument()
    );
    expect(
      screen.queryByText(/checks notion for changes every 5 minutes\./i)
    ).not.toBeInTheDocument();
  });

  test('renders no second line when last_error is null and no schedule matches', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 1,
          notion_page_id: 'a'.repeat(32),
          last_error: null,
        }),
      ]),
    });

    renderSubs(backend);

    await waitFor(() =>
      expect(screen.getByText('My deck')).toBeInTheDocument()
    );
    expect(screen.queryByText(/last check failed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/next export at/i)).not.toBeInTheDocument();
  });

  test('renders the error line when last_error is set', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 1,
          notion_page_id: 'a'.repeat(32),
          last_error: 'boom',
        }),
      ]),
    });

    renderSubs(backend);

    await waitFor(() =>
      expect(
        screen.getByText(/last check failed — we'll try again soon/i)
      ).toBeInTheDocument()
    );
  });

  test('says the sync is paused and offers Reconnect when Notion rejected the connection', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 1,
          notion_page_id: 'a'.repeat(32),
          enabled: false,
          last_error: 'notion_reconnect_needed',
        }),
      ]),
    });

    renderSubs(backend);

    await waitFor(() =>
      expect(
        screen.getByText(/paused — notion needs to be reconnected/i)
      ).toBeInTheDocument()
    );
    expect(
      screen.getByRole('link', { name: 'Reconnect Notion' })
    ).toHaveAttribute('href', '/notion');
    expect(screen.queryByText(/last check failed/i)).not.toBeInTheDocument();
  });

  test('renders next-export line when schedule matches and is enabled', async () => {
    const matchingId = 'a'.repeat(32);
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 1,
          notion_page_id: matchingId,
          last_error: null,
        }),
      ]),
    });

    renderSubs(
      backend,
      sampleSchedule({
        database_id: matchingId,
        time_of_day: '09:15',
        enabled: true,
      })
    );

    await waitFor(() =>
      expect(screen.getByText(/^next export at /i)).toBeInTheDocument()
    );
  });

  test('does not render next-export line when schedule is disabled', async () => {
    const matchingId = 'a'.repeat(32);
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 1,
          notion_page_id: matchingId,
          last_error: null,
        }),
      ]),
    });

    renderSubs(
      backend,
      sampleSchedule({ database_id: matchingId, enabled: false })
    );

    await waitFor(() =>
      expect(screen.getByText('My deck')).toBeInTheDocument()
    );
    expect(screen.queryByText(/next export at/i)).not.toBeInTheDocument();
  });

  test('does not render next-export line when schedule database_id does not match', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 1,
          notion_page_id: 'a'.repeat(32),
          last_error: null,
        }),
      ]),
    });

    renderSubs(
      backend,
      sampleSchedule({ database_id: 'b'.repeat(32), enabled: true })
    );

    await waitFor(() =>
      expect(screen.getByText('My deck')).toBeInTheDocument()
    );
    expect(screen.queryByText(/next export at/i)).not.toBeInTheDocument();
  });

  test('renders the page icon next to the title when present', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 1,
          notion_page_id: 'a'.repeat(32),
          notion_page_icon: '📘',
        }),
      ]),
    });

    renderSubs(backend);

    await waitFor(() =>
      expect(screen.getByText('My deck')).toBeInTheDocument()
    );
    expect(screen.getByText('📘')).toBeInTheDocument();
  });

  test('renders an image icon when notion_page_icon is a URL', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 1,
          notion_page_id: 'a'.repeat(32),
          notion_page_icon: 'https://example.com/icon.png',
        }),
      ]),
    });

    renderSubs(backend);

    await waitFor(() =>
      expect(screen.getByText('My deck')).toBeInTheDocument()
    );
    const img = screen.getByAltText('icon') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe('https://example.com/icon.png');
  });

  test('shows "Preparing your first sync" for a brand new subscription with no last_synced_at', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 1,
          notion_page_id: 'a'.repeat(32),
          last_synced_at: null,
          last_polled_at: null,
          last_error: null,
        }),
      ]),
    });

    renderSubs(backend);

    await waitFor(() =>
      expect(screen.getByText(/preparing your first sync/i)).toBeInTheDocument()
    );
  });

  test('kebab menu shows "Update now" with a per-deck aria-label, above "Stop"', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 11, notion_page_id: 'a'.repeat(32) }),
      ]),
    });

    renderSubs(backend);

    const kebab = await screen.findByRole('button', {
      name: /options for my deck/i,
    });
    fireEvent.click(kebab);

    const updateItem = await screen.findByRole('menuitem', {
      name: /update my deck now/i,
    });
    const stopItem = screen.getByRole('menuitem', { name: /^stop$/i });
    expect(updateItem).toBeInTheDocument();
    expect(stopItem).toBeInTheDocument();
    expect(updateItem.compareDocumentPosition(stopItem)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  test('kebab menu links "Open in Notion" to the page URL and "Edit settings" to the rules editor', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 11,
          notion_page_id: 'a'.repeat(32),
          notion_page_url: 'https://notion.so/My-deck',
        }),
      ]),
    });

    renderSubs(backend);

    fireEvent.click(
      await screen.findByRole('button', { name: /options for my deck/i })
    );

    const openInNotion = await screen.findByRole('menuitem', {
      name: /open my deck in notion/i,
    });
    expect(openInNotion).toHaveAttribute('href', 'https://notion.so/My-deck');

    const editSettings = screen.getByRole('menuitem', {
      name: /edit settings for my deck/i,
    });
    expect(editSettings).toHaveAttribute('href', `/rules/${'a'.repeat(32)}`);
  });

  test('clicking "Update now" calls refreshAnkifySubscription with the row id and shows a success flash', async () => {
    const refresh = vi.fn(async (_id: number) => ({
      created: 3,
      updated: 1,
      conflicts: 0,
      unchanged: 5,
      errors: [],
      anki_web_sync: 'synced' as const,
      anki_web_sync_error: null,
      diagnostic: null,
    }));
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 11, notion_page_id: 'a'.repeat(32) }),
      ]),
      refreshAnkifySubscription: refresh,
    });

    renderSubs(backend);

    const kebab = await screen.findByRole('button', {
      name: /options for my deck/i,
    });
    fireEvent.click(kebab);
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /update my deck now/i })
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledWith(11));
    expect(
      await screen.findByText(/updated · 3 new, 1 changed/i)
    ).toBeInTheDocument();
  });

  test('State A: blocks_matched === 0 shows "No patterns found" flash and the zero banner', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 12, notion_page_id: 'b'.repeat(32) }),
      ]),
      refreshAnkifySubscription: vi.fn(async () => ({
        created: 0,
        updated: 0,
        conflicts: 0,
        unchanged: 0,
        errors: [],
        anki_web_sync: 'skipped' as const,
        anki_web_sync_error: null,
        diagnostic: {
          blocks_scanned: 7,
          blocks_matched: 0,
          pattern_hits: {},
          unmatched_samples: undefined,
        },
      })),
    });

    renderSubs(backend);

    fireEvent.click(
      await screen.findByRole('button', { name: /options for my deck/i })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /update my deck now/i })
    );

    expect(await screen.findByText(/no patterns found/i)).toBeInTheDocument();
    expect(
      await screen.findByRole('link', { name: /what ankify looks for/i })
    ).toBeInTheDocument();
  });

  test('State B: blocks_matched > 0 but nothing changed shows "Already up to date" flash and no banner', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 12, notion_page_id: 'b'.repeat(32) }),
      ]),
      refreshAnkifySubscription: vi.fn(async () => ({
        created: 0,
        updated: 0,
        conflicts: 0,
        unchanged: 9,
        errors: [],
        anki_web_sync: 'skipped' as const,
        anki_web_sync_error: null,
        diagnostic: {
          blocks_scanned: 9,
          blocks_matched: 5,
          pattern_hits: { toggle: 5 },
          unmatched_samples: undefined,
        },
      })),
    });

    renderSubs(backend);

    fireEvent.click(
      await screen.findByRole('button', { name: /options for my deck/i })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /update my deck now/i })
    );

    expect(await screen.findByText(/already up to date/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /what ankify looks for/i })
    ).not.toBeInTheDocument();
  });

  test('graceful degrade: diagnostic null + zero count shows "Already up to date" and no banner', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 12, notion_page_id: 'b'.repeat(32) }),
      ]),
      refreshAnkifySubscription: vi.fn(async () => ({
        created: 0,
        updated: 0,
        conflicts: 0,
        unchanged: 9,
        errors: [],
        anki_web_sync: 'skipped' as const,
        anki_web_sync_error: null,
        diagnostic: null,
      })),
    });

    renderSubs(backend);

    fireEvent.click(
      await screen.findByRole('button', { name: /options for my deck/i })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /update my deck now/i })
    );

    expect(await screen.findByText(/already up to date/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /what ankify looks for/i })
    ).not.toBeInTheDocument();
  });

  test('a 429 cooldown error renders inline retry guidance', async () => {
    const cooldownError = Object.assign(new Error('cooldown'), {
      status: 429,
      retryAfterSeconds: 22,
    });
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 13, notion_page_id: 'c'.repeat(32) }),
      ]),
      refreshAnkifySubscription: vi.fn(async () => {
        throw cooldownError;
      }),
    });

    renderSubs(backend);

    fireEvent.click(
      await screen.findByRole('button', { name: /options for my deck/i })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /update my deck now/i })
    );

    expect(await screen.findByText(/try again in 22s/i)).toBeInTheDocument();
  });

  test('a refresh that produced conflicts points the user at the banner above', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 14, notion_page_id: 'd'.repeat(32) }),
      ]),
      refreshAnkifySubscription: vi.fn(async () => ({
        created: 0,
        updated: 0,
        conflicts: 2,
        unchanged: 1,
        errors: [],
        anki_web_sync: 'skipped' as const,
        anki_web_sync_error: null,
        diagnostic: null,
      })),
    });

    renderSubs(backend);

    fireEvent.click(
      await screen.findByRole('button', { name: /options for my deck/i })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /update my deck now/i })
    );

    expect(
      await screen.findByText(/needs a decision — see banner above/i)
    ).toBeInTheDocument();
  });

  test('the row shows "Updating now…" while the refresh is in flight', async () => {
    let resolveRefresh: (value: {
      created: number;
      updated: number;
      conflicts: number;
      unchanged: number;
      errors: string[];
      anki_web_sync: 'synced' | 'failed' | 'skipped';
      anki_web_sync_error: string | null;
      diagnostic: null;
    }) => void = () => undefined;
    const refresh = vi.fn(
      () =>
        new Promise<{
          created: number;
          updated: number;
          conflicts: number;
          unchanged: number;
          errors: string[];
          anki_web_sync: 'synced' | 'failed' | 'skipped';
          anki_web_sync_error: string | null;
          diagnostic: null;
        }>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 15, notion_page_id: 'e'.repeat(32) }),
      ]),
      refreshAnkifySubscription: refresh,
    });

    renderSubs(backend);

    fireEvent.click(
      await screen.findByRole('button', { name: /options for my deck/i })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /update my deck now/i })
    );

    expect(await screen.findByText(/updating now…/i)).toBeInTheDocument();

    await act(async () => {
      resolveRefresh({
        created: 1,
        updated: 0,
        conflicts: 0,
        unchanged: 0,
        errors: [],
        anki_web_sync: 'synced',
        anki_web_sync_error: null,
        diagnostic: null,
      });
    });

    await waitFor(() =>
      expect(screen.queryByText(/updating now…/i)).not.toBeInTheDocument()
    );
  });

  test('shows zero-cards banner with block count when refresh returns 0 matched blocks', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 20, notion_page_id: 'f'.repeat(32) }),
      ]),
      refreshAnkifySubscription: vi.fn(async () => ({
        created: 0,
        updated: 0,
        conflicts: 0,
        unchanged: 0,
        errors: [],
        anki_web_sync: 'skipped' as const,
        anki_web_sync_error: null,
        diagnostic: {
          blocks_scanned: 12,
          blocks_matched: 0,
          pattern_hits: {},
          unmatched_samples: undefined,
        },
      })),
    });

    renderSubs(backend);

    fireEvent.click(
      await screen.findByRole('button', { name: /options for my deck/i })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /update my deck now/i })
    );

    expect(
      await screen.findByRole('link', { name: /what ankify looks for/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'STRONG' && el.textContent === '12'
      )
    ).toBeInTheDocument();
  });

  test('shows unmatched_samples in a details panel when present with updated summary text', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 21, notion_page_id: 'g'.repeat(32) }),
      ]),
      refreshAnkifySubscription: vi.fn(async () => ({
        created: 0,
        updated: 0,
        conflicts: 0,
        unchanged: 0,
        errors: [],
        anki_web_sync: 'skipped' as const,
        anki_web_sync_error: null,
        diagnostic: {
          blocks_scanned: 5,
          blocks_matched: 0,
          pattern_hits: {},
          unmatched_samples: ['Introduction', 'Chapter 1', 'Summary'],
        },
      })),
    });

    renderSubs(backend);

    fireEvent.click(
      await screen.findByRole('button', { name: /options for my deck/i })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /update my deck now/i })
    );

    expect(
      await screen.findByText(/what we saw on this page \(first 3\)/i)
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Introduction')).toBeInTheDocument()
    );
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
  });

  test('diagnostic null with zero count shows "Already up to date" and no banner', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 22, notion_page_id: 'h'.repeat(32) }),
      ]),
      refreshAnkifySubscription: vi.fn(async () => ({
        created: 0,
        updated: 0,
        conflicts: 0,
        unchanged: 0,
        errors: [],
        anki_web_sync: 'skipped' as const,
        anki_web_sync_error: null,
        diagnostic: null,
      })),
    });

    renderSubs(backend);

    fireEvent.click(
      await screen.findByRole('button', { name: /options for my deck/i })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /update my deck now/i })
    );

    expect(await screen.findByText(/already up to date/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /what ankify looks for/i })
    ).not.toBeInTheDocument();
  });

  test('does not show zero-cards banner when cards were created', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 23, notion_page_id: 'i'.repeat(32) }),
      ]),
      refreshAnkifySubscription: vi.fn(async () => ({
        created: 5,
        updated: 0,
        conflicts: 0,
        unchanged: 0,
        errors: [],
        anki_web_sync: 'synced' as const,
        anki_web_sync_error: null,
        diagnostic: {
          blocks_scanned: 5,
          blocks_matched: 5,
          pattern_hits: { toggle: 5 },
          unmatched_samples: undefined,
        },
      })),
    });

    renderSubs(backend);

    fireEvent.click(
      await screen.findByRole('button', { name: /options for my deck/i })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /update my deck now/i })
    );

    await waitFor(() =>
      expect(screen.getByText(/updated · 5 new cards/i)).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('link', { name: /what ankify looks for/i })
    ).not.toBeInTheDocument();
  });

  test('a calm offline last_error renders the muted offline line, not the danger line', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 1,
          notion_page_id: 'a'.repeat(32),
          last_error: 'Anki client offline — will retry next tick',
        }),
      ]),
    });

    renderSubs(backend);

    await waitFor(() =>
      expect(
        screen.getByText(/anki client offline — will retry next tick/i)
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/last check failed/i)).not.toBeInTheDocument();
  });

  test('a genuine last_error renders the "last check failed" line', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 1,
          notion_page_id: 'a'.repeat(32),
          last_error: 'AnkiConnect returned HTTP 500',
        }),
      ]),
    });

    renderSubs(backend);

    await waitFor(() =>
      expect(
        screen.getByText(/last check failed — we'll try again soon/i)
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/anki client offline/i)).not.toBeInTheDocument();
  });

  test('error line takes precedence over next-export line', async () => {
    const matchingId = 'a'.repeat(32);
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 1,
          notion_page_id: matchingId,
          last_error: 'boom',
        }),
      ]),
    });

    renderSubs(
      backend,
      sampleSchedule({ database_id: matchingId, enabled: true })
    );

    await waitFor(() =>
      expect(
        screen.getByText(/last check failed — we'll try again soon/i)
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/next export at/i)).not.toBeInTheDocument();
  });
});

describe('NotionSubscriptions subscribe error mapping', () => {
  const makeSubscribeError = (message: string, status?: number) =>
    Object.assign(new Error(message), { status });

  it.each([
    [
      401,
      'Unauthorized',
      "Auto Sync isn't active on this account.",
      'Manage subscription',
    ],
    [
      403,
      'Forbidden',
      "Auto Sync isn't active on this account.",
      'Manage subscription',
    ],
  ])(
    'status %d → paywall copy with manage link',
    async (status, message, expectedText, expectedLink) => {
      const backend = makeBackend({
        subscribeAnkifyNotionPage: vi.fn(async () => {
          throw makeSubscribeError(message, status);
        }),
      });
      renderSubs(backend);

      const input = await screen.findByPlaceholderText(
        /https:\/\/www\.notion\.so/i
      );
      fireEvent.change(input, {
        target: { value: 'https://www.notion.so/test-' + 'a'.repeat(32) },
      });
      fireEvent.submit(input.closest('form')!);

      expect(await screen.findByText(expectedText)).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: expectedLink })
      ).toBeInTheDocument();
    }
  );

  it('409 NotionNotConnected → Notion connect copy with link', async () => {
    const backend = makeBackend({
      subscribeAnkifyNotionPage: vi.fn(async () => {
        throw makeSubscribeError('Notion is not connected', 409);
      }),
    });
    renderSubs(backend);

    const input = await screen.findByPlaceholderText(
      /https:\/\/www\.notion\.so/i
    );
    fireEvent.change(input, {
      target: { value: 'https://www.notion.so/test-' + 'a'.repeat(32) },
    });
    fireEvent.submit(input.closest('form')!);

    expect(
      await screen.findByText("Notion isn't connected to 2anki.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Connect Notion' })
    ).toBeInTheDocument();
  });

  it('409 NoActiveAnkifyClient → set up Anki copy with link', async () => {
    const backend = makeBackend({
      subscribeAnkifyNotionPage: vi.fn(async () => {
        throw makeSubscribeError(
          'No active Ankify client. Provision one before subscribing.',
          409
        );
      }),
    });
    renderSubs(backend);

    const input = await screen.findByPlaceholderText(
      /https:\/\/www\.notion\.so/i
    );
    fireEvent.change(input, {
      target: { value: 'https://www.notion.so/test-' + 'a'.repeat(32) },
    });
    fireEvent.submit(input.closest('form')!);

    expect(
      await screen.findByText("Your hosted Anki isn't set up yet.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Set up Anki' })
    ).toBeInTheDocument();
  });

  it('503 → AnkiConnect unreachable copy (no link)', async () => {
    const backend = makeBackend({
      subscribeAnkifyNotionPage: vi.fn(async () => {
        throw makeSubscribeError('AnkiConnect is unreachable.', 503);
      }),
    });
    renderSubs(backend);

    const input = await screen.findByPlaceholderText(
      /https:\/\/www\.notion\.so/i
    );
    fireEvent.change(input, {
      target: { value: 'https://www.notion.so/test-' + 'a'.repeat(32) },
    });
    fireEvent.submit(input.closest('form')!);

    expect(
      await screen.findByText(
        "Anki isn't responding right now. Try again in a moment."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('unknown error → fallback copy (no link)', async () => {
    const backend = makeBackend({
      subscribeAnkifyNotionPage: vi.fn(async () => {
        throw makeSubscribeError('network failure');
      }),
    });
    renderSubs(backend);

    const input = await screen.findByPlaceholderText(
      /https:\/\/www\.notion\.so/i
    );
    fireEvent.change(input, {
      target: { value: 'https://www.notion.so/test-' + 'a'.repeat(32) },
    });
    fireEvent.submit(input.closest('form')!);

    expect(
      await screen.findByText(
        'Something broke on our end. Try again, or email support@2anki.net.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('NotionSubscriptions deck location', () => {
  test('saving a deck location calls the API with the page id and entered path', async () => {
    const subscribe = vi.fn(async () => ({
      created: 0,
      updated: 0,
      conflicts: 0,
      unchanged: 0,
      errors: [],
      anki_web_sync: 'skipped' as const,
      anki_web_sync_error: null,
      diagnostic: null,
    }));
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({ id: 21, notion_page_id: 'a'.repeat(32) }),
      ]),
      subscribeAnkifyNotionPage: subscribe,
    });

    renderSubs(backend);

    fireEvent.click(
      await screen.findByRole('button', { name: /options for my deck/i })
    );
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: /set deck location for my deck/i,
      })
    );

    const input = await screen.findByLabelText(/anki deck location/i);
    fireEvent.change(input, {
      target: { value: 'MS3::Surgery::Small Bowel' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save location/i }));

    await waitFor(() =>
      expect(subscribe).toHaveBeenCalledWith({
        notionPageId: 'a'.repeat(32),
        targetDeck: 'MS3::Surgery::Small Bowel',
      })
    );
  });

  test('shows the In Anki line when a non-default target_deck is set', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 22,
          notion_page_id: 'b'.repeat(32),
          target_deck: 'MS3::Pharmacology',
        }),
      ]),
    });

    renderSubs(backend);

    expect(
      await screen.findByText(/In Anki: MS3::Pharmacology/i)
    ).toBeInTheDocument();
  });
});

describe('NotionSubscriptions cockpit data column', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
  });

  test('shows backlog matched to the deck by derived name', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 30,
          notion_page_id: 'a'.repeat(32),
          target_deck: 'MS3::Pharmacology',
        }),
      ]),
      getAnkifyStats: vi.fn(async () => ({
        connected: true as const,
        reviewedToday: 0,
        reviewedThisYear: 0,
        currentStreak: 0,
        longestStreak: 0,
        reviewsByDay: [],
        decks: [
          {
            fullName: 'MS3::Pharmacology',
            name: 'Pharmacology',
            depth: 1,
            new: 3,
            learning: 2,
            review: 5,
            total: 10,
          },
        ],
      })),
    });

    renderSubs(backend);

    expect(await screen.findByText('▲7 · +3 new')).toBeInTheDocument();
  });

  test('shows nothing extra when no deck matches', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 31,
          notion_page_id: 'a'.repeat(32),
          target_deck: 'MS3::Pharmacology',
        }),
      ]),
      getAnkifyStats: vi.fn(async () => ({
        connected: true as const,
        reviewedToday: 0,
        reviewedThisYear: 0,
        currentStreak: 0,
        longestStreak: 0,
        reviewsByDay: [],
        decks: [
          {
            fullName: 'Other::Deck',
            name: 'Deck',
            depth: 1,
            new: 9,
            learning: 9,
            review: 9,
            total: 27,
          },
        ],
      })),
    });

    renderSubs(backend);

    await waitFor(() =>
      expect(screen.getByText('My deck')).toBeInTheDocument()
    );
    expect(screen.queryByText(/▲/)).not.toBeInTheDocument();
  });

  test('shows the maturity percentage for a connected deck', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 32,
          notion_page_id: 'a'.repeat(32),
          target_deck: 'MS3::Pharmacology',
        }),
      ]),
      getAnkifyDeckMaturity: vi.fn(async () => ({
        connected: true as const,
        matureCount: 30,
        total: 120,
        avgIntervalDays: 40,
      })),
    });

    renderSubs(backend);

    expect(await screen.findByText('25% mature')).toBeInTheDocument();
  });

  test('shows no maturity when the deck is offline', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [
        sampleSubscription({
          id: 33,
          notion_page_id: 'a'.repeat(32),
          target_deck: 'MS3::Pharmacology',
        }),
      ]),
      getAnkifyDeckMaturity: vi.fn(async () => ({ connected: false }) as const),
    });

    renderSubs(backend);

    await waitFor(() =>
      expect(screen.getByText('My deck')).toBeInTheDocument()
    );
    expect(screen.queryByText(/mature/i)).not.toBeInTheDocument();
  });
});

describe('NotionSubscriptions onTabChange', () => {
  const renderWithTabChange = (
    backend: Backend,
    onTabChange: (tab: 'decks' | 'find' | 'leeches' | 'review') => void
  ) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <NotionSubscriptions
            backend={backend}
            schedule={null}
            onTabChange={onTabChange}
          />
        </QueryClientProvider>
      </MemoryRouter>
    );
  };

  test('fires decks on default mount when subscriptions exist', async () => {
    const onTabChange = vi.fn();
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [sampleSubscription()]),
    });

    renderWithTabChange(backend, onTabChange);

    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('decks'));
  });

  test('fires find on default mount when there are no subscriptions', async () => {
    const onTabChange = vi.fn();
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => []),
    });

    renderWithTabChange(backend, onTabChange);

    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('find'));
  });

  test('fires the clicked tab when the user switches tabs', async () => {
    const onTabChange = vi.fn();
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => [sampleSubscription()]),
    });

    renderWithTabChange(backend, onTabChange);

    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('decks'));
    fireEvent.click(screen.getByRole('tab', { name: /find pages/i }));
    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('find'));
  });
});

const hexId = (n: number): string => n.toString(16).padStart(32, '0');

const manyDecks = (specs: Array<Partial<Subscription>>): Subscription[] =>
  specs.map((spec, index) =>
    sampleSubscription({
      id: index + 1,
      notion_page_id: hexId(index + 1),
      ...spec,
    })
  );

const renderedTitleOrder = (): string[] =>
  screen
    .getAllByRole('listitem')
    .map((li) => li.querySelector('a')?.textContent ?? '')
    .filter((text) => text.length > 0);

describe('NotionSubscriptions deck sort', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
    vi.clearAllMocks();
  });

  const eightHealthy = (): Subscription[] =>
    manyDecks(
      Array.from({ length: 8 }, (_, i) => ({
        notion_page_title: `Deck ${i + 1}`,
        last_synced_at: new Date(2026, 0, i + 1).toISOString(),
      }))
    );

  test('does not show the control row under 8 decks', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () =>
        manyDecks(
          Array.from({ length: 7 }, (_, i) => ({
            notion_page_title: `Deck ${i + 1}`,
          }))
        )
      ),
    });
    renderSubs(backend);
    await waitFor(() =>
      expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0)
    );
    expect(screen.queryByLabelText(/sort decks/i)).not.toBeInTheDocument();
  });

  test('shows the sort select at 8 decks with an accessible label', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => eightHealthy()),
    });
    renderSubs(backend);
    await waitFor(() =>
      expect(screen.getByLabelText(/sort decks/i)).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/search your decks/i)).toBeInTheDocument();
  });

  test('default sort is Status — failed deck renders first with no interaction', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () =>
        manyDecks([
          { notion_page_title: 'Healthy A', last_error: null },
          { notion_page_title: 'Healthy B', last_error: null },
          { notion_page_title: 'Healthy C', last_error: null },
          { notion_page_title: 'Healthy D', last_error: null },
          { notion_page_title: 'Healthy E', last_error: null },
          { notion_page_title: 'Healthy F', last_error: null },
          { notion_page_title: 'Healthy G', last_error: null },
          { notion_page_title: 'Broken deck', last_error: 'boom' },
        ])
      ),
    });
    renderSubs(backend);
    await waitFor(() =>
      expect(screen.getByLabelText(/sort decks/i)).toBeInTheDocument()
    );
    expect(
      (screen.getByLabelText(/sort decks/i) as HTMLSelectElement).value
    ).toBe('status');
    expect(renderedTitleOrder()[0]).toBe('Broken deck');
  });

  test('switching to Name reorders the rendered rows A→Z', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () =>
        manyDecks([
          { notion_page_title: 'Zebra' },
          { notion_page_title: 'Apple' },
          { notion_page_title: 'Mango' },
          { notion_page_title: 'Cherry' },
          { notion_page_title: 'Banana' },
          { notion_page_title: 'Date' },
          { notion_page_title: 'Fig' },
          { notion_page_title: 'Grape' },
        ])
      ),
    });
    renderSubs(backend);
    await waitFor(() =>
      expect(screen.getByLabelText(/sort decks/i)).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText(/sort decks/i), {
      target: { value: 'name' },
    });
    await waitFor(() =>
      expect(renderedTitleOrder()).toEqual([
        'Apple',
        'Banana',
        'Cherry',
        'Date',
        'Fig',
        'Grape',
        'Mango',
        'Zebra',
      ])
    );
  });

  test('sort applies after the search filter', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () =>
        manyDecks([
          { notion_page_title: 'Cardiology Zebra' },
          { notion_page_title: 'Cardiology Apple' },
          { notion_page_title: 'Neurology Mango' },
          { notion_page_title: 'Cardiology Banana' },
          { notion_page_title: 'Neurology Pear' },
          { notion_page_title: 'Other Deck 1' },
          { notion_page_title: 'Other Deck 2' },
          { notion_page_title: 'Other Deck 3' },
        ])
      ),
    });
    renderSubs(backend);
    await waitFor(() =>
      expect(screen.getByLabelText(/sort decks/i)).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText(/sort decks/i), {
      target: { value: 'name' },
    });
    fireEvent.change(screen.getByLabelText(/search your decks/i), {
      target: { value: 'cardiology' },
    });
    await waitFor(() =>
      expect(renderedTitleOrder()).toEqual([
        'Cardiology Apple',
        'Cardiology Banana',
        'Cardiology Zebra',
      ])
    );
  });

  test('an empty search result shows the named empty state and clear action', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => eightHealthy()),
    });
    renderSubs(backend);
    await waitFor(() =>
      expect(screen.getByLabelText(/search your decks/i)).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText(/search your decks/i), {
      target: { value: 'zzzznomatch' },
    });
    await waitFor(() =>
      expect(screen.getByText(/no decks match/i)).toBeInTheDocument()
    );
    expect(screen.getByText('“zzzznomatch”')).toBeInTheDocument();
    expect(screen.getByText(/to see all 8\./i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear the search/i }));
    await waitFor(() =>
      expect(screen.queryByText(/no decks match/i)).not.toBeInTheDocument()
    );
    expect(screen.getAllByRole('listitem').length).toBe(8);
  });

  test('fires ankify_decklist_sorted with the key on change, no titles', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => eightHealthy()),
    });
    renderSubs(backend);
    await waitFor(() =>
      expect(screen.getByLabelText(/sort decks/i)).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText(/sort decks/i), {
      target: { value: 'last-synced' },
    });
    expect(track).toHaveBeenCalledWith('ankify_decklist_sorted', {
      key: 'last-synced',
    });
  });

  test('persists the chosen sort and reads it on the next mount', async () => {
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => eightHealthy()),
    });
    const first = renderSubs(backend);
    await waitFor(() =>
      expect(screen.getByLabelText(/sort decks/i)).toBeInTheDocument()
    );
    fireEvent.change(screen.getByLabelText(/sort decks/i), {
      target: { value: 'name' },
    });
    expect(globalThis.localStorage?.getItem('ankify-deck-sort')).toBe('name');
    first.unmount();

    renderSubs(backend);
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/sort decks/i) as HTMLSelectElement).value
      ).toBe('name')
    );
  });

  test('an unrecognised stored value falls back to Status', async () => {
    globalThis.localStorage?.setItem('ankify-deck-sort', 'bogus');
    const backend = makeBackend({
      listAnkifySubscriptions: vi.fn(async () => eightHealthy()),
    });
    renderSubs(backend);
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/sort decks/i) as HTMLSelectElement).value
      ).toBe('status')
    );
  });
});
