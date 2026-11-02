import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import AnkifySetupPage from './AnkifySetupPage';
import { Backend } from '../../lib/backend/Backend';

vi.mock('../../lib/backend/getUserLocals', () => ({
  getUserLocals: vi.fn(),
}));

const track = vi.fn();
vi.mock('../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => track(...args),
}));

const reportClientError = vi.fn();
vi.mock('../../lib/reportClientError', () => ({
  reportClientError: (...args: unknown[]) => reportClientError(...args),
}));

vi.mock('../../lib/analytics/reportPurchaseConversion', () => ({
  reportPurchaseConversion: vi.fn(),
  replayPendingPurchaseConversions: vi.fn(),
}));

import { getUserLocals } from '../../lib/backend/getUserLocals';

const localsWith = (
  autoSyncActive: boolean | undefined,
  planSource?: 'stripe' | 'apple' | 'lifetime' | null
) =>
  ({
    user: { id: 7, email: 'learner@example.com' },
    locals: {
      owner: 42,
      patreon: false,
      subscriber: false,
      subscriptionInfo: { active: false, email: '', linked_email: '' },
      planSource,
    },
    linked_email: '',
    autoSyncActive,
  }) as never;

const makeBackend = (overrides: Partial<Backend> = {}): Backend =>
  ({
    listAnkifyClients: vi.fn(async () => []),
    provisionAnkifyClient: vi.fn(),
    respinAnkifyClient: vi.fn(),
    reissueAnkifySessionUrl: vi.fn(),
    checkAnkifyActiveClientReady: vi.fn(async () => ({ ready: false })),
    checkAnkifyAnkiWebStatus: vi.fn(async () => ({ status: 'unlinked' })),
    ...overrides,
  }) as unknown as Backend;

const renderSetup = (
  backend: Backend,
  opts: { path?: string; retries?: boolean } = {}
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: opts.retries ? { retry: 3, retryDelay: 0 } : { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[opts.path ?? '/ankify/setup']}>
        <Routes>
          <Route
            path="/ankify/setup"
            element={<AnkifySetupPage backend={backend} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('AnkifySetupPage plan panel', () => {
  beforeEach(() => {
    track.mockReset();
    vi.mocked(getUserLocals).mockReset();
  });

  test('shows the Auto Sync plan panel when the user lacks Auto Sync', async () => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(false));

    renderSetup(makeBackend());

    expect(
      await screen.findByRole('heading', {
        name: /auto sync is its own plan/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /see auto sync pricing/i })
    ).toHaveAttribute('href', '/pricing');
    expect(
      screen.queryByRole('button', { name: /start anki/i })
    ).not.toBeInTheDocument();
  });

  test('fires ankify_plan_required_viewed once when the panel renders', async () => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(false));

    renderSetup(makeBackend());

    await screen.findByRole('heading', { name: /auto sync is its own plan/i });
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('ankify_plan_required_viewed')
    );
    expect(track).toHaveBeenCalledTimes(1);
  });

  test('shows the normal setup flow when Auto Sync is active', async () => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(true));

    renderSetup(makeBackend());

    expect(
      await screen.findByRole('button', { name: /start anki/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /auto sync is its own plan/i })
    ).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalledWith('ankify_plan_required_viewed');
  });

  test('a 403 from the clients list shows the panel without retrying', async () => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(false));
    const forbidden = Object.assign(new Error('Forbidden'), { status: 403 });
    const listAnkifyClients = vi.fn(async () => {
      throw forbidden;
    });
    const backend = makeBackend({ listAnkifyClients });

    renderSetup(backend, { retries: true });

    expect(
      await screen.findByRole('heading', {
        name: /auto sync is its own plan/i,
      })
    ).toBeInTheDocument();
    expect(listAnkifyClients).toHaveBeenCalledTimes(1);
  });

  test('retries a 500 from the clients list', async () => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(true));
    const serverError = Object.assign(new Error('Server error'), {
      status: 500,
    });
    const listAnkifyClients = vi.fn(async () => {
      throw serverError;
    });
    const backend = makeBackend({ listAnkifyClients });

    renderSetup(backend, { retries: true });

    await waitFor(() => expect(listAnkifyClients).toHaveBeenCalledTimes(4));
  });

  test('checkout success shows the finishing state, not the panel', async () => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(false));
    const forbidden = Object.assign(new Error('Forbidden'), { status: 403 });
    const backend = makeBackend({
      listAnkifyClients: vi.fn(async () => {
        throw forbidden;
      }),
    });

    renderSetup(backend, { path: '/ankify/setup?checkout=success' });

    expect(
      await screen.findByText(/activating auto sync/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /auto sync is its own plan/i })
    ).not.toBeInTheDocument();
  });

  test('access that lands after checkout shows setup, not the panel', async () => {
    vi.mocked(getUserLocals)
      .mockResolvedValueOnce(localsWith(false))
      .mockResolvedValue(localsWith(true));
    const forbidden = Object.assign(new Error('Forbidden'), { status: 403 });
    const listAnkifyClients = vi
      .fn()
      .mockRejectedValueOnce(forbidden)
      .mockResolvedValue([]);
    const backend = makeBackend({ listAnkifyClients });

    renderSetup(backend, { path: '/ankify/setup?checkout=success' });

    expect(
      await screen.findByText(/activating auto sync/i)
    ).toBeInTheDocument();
    expect(
      await screen.findByRole(
        'button',
        { name: /start anki/i },
        { timeout: 6000 }
      )
    ).toBeInTheDocument();
  });

  test('points Apple-plan users to support instead of pricing', async () => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(false, 'apple'));

    renderSetup(makeBackend());

    expect(await screen.findByText(/support@2anki\.net/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /see auto sync pricing/i })
    ).not.toBeInTheDocument();
  });

  test('a 403 on provisioning swaps the generic error for the plan panel', async () => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(undefined));
    const forbidden = Object.assign(new Error('Forbidden'), { status: 403 });
    const backend = makeBackend({
      provisionAnkifyClient: vi.fn(async () => {
        throw forbidden;
      }),
    });

    renderSetup(backend);

    const start = await screen.findByRole('button', { name: /start anki/i });
    start.click();

    expect(
      await screen.findByRole('heading', {
        name: /auto sync is its own plan/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/anki couldn't start\. try again/i)
    ).not.toBeInTheDocument();
  });
});

describe('AnkifySetupPage claims a deck saved for a plan after checkout', () => {
  beforeEach(() => {
    vi.mocked(getUserLocals).mockReset();
    reportClientError.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const claimResult = (status: number) => ({
    status,
    downloadKey: status === 200 ? 'full-deck.apkg' : null,
    cardCount: status === 200 ? 40 : null,
    deckName: status === 200 ? 'notes' : null,
    kind: status === 200 ? ('plan' as const) : null,
    error: null,
  });

  test('builds the saved deck once the plan is active, retrying while it appears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(true));
    const getHeldDeck = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ cardCount: 0, cardsHeldBack: 40 });
    const claimHeldDeck = vi.fn(async () => claimResult(200));

    renderSetup(makeBackend({ getHeldDeck, claimHeldDeck }), {
      path: '/ankify/setup?checkout=success&session_id=cs_auto',
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });

    await waitFor(() => expect(claimHeldDeck).toHaveBeenCalledTimes(1));
    expect(getHeldDeck).toHaveBeenCalledTimes(3);
    expect(
      await screen.findByRole('button', { name: /start anki/i })
    ).toBeInTheDocument();
    expect(reportClientError).not.toHaveBeenCalled();
  });

  test.each([
    ['no saved deck', 404],
    ['an expired saved deck', 410],
  ])('stays quiet when there is %s to claim', async (_label, status) => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(true));
    const getHeldDeck = vi.fn(async () => ({
      cardCount: 0,
      cardsHeldBack: 40,
    }));
    const claimHeldDeck = vi.fn(async () => claimResult(status));

    renderSetup(makeBackend({ getHeldDeck, claimHeldDeck }), {
      path: '/ankify/setup?checkout=success',
    });

    await waitFor(() => expect(claimHeldDeck).toHaveBeenCalledTimes(1));
    expect(reportClientError).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('reports a claim that fails on our side', async () => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(true));
    const claimHeldDeck = vi.fn(async () => claimResult(500));

    renderSetup(
      makeBackend({
        getHeldDeck: vi.fn(async () => ({ cardCount: 0, cardsHeldBack: 40 })),
        claimHeldDeck,
      }),
      { path: '/ankify/setup?checkout=success' }
    );

    await waitFor(() =>
      expect(reportClientError).toHaveBeenCalledWith(expect.any(Error), {
        surface: 'held_deck_claim_after_checkout',
      })
    );
    expect((reportClientError.mock.calls[0][0] as Error).message).toContain(
      'HTTP 500'
    );
  });

  test('reports a claim that throws', async () => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(true));
    const failure = new TypeError('Failed to parse the claim');

    renderSetup(
      makeBackend({
        getHeldDeck: vi.fn(async () => ({ cardCount: 0, cardsHeldBack: 40 })),
        claimHeldDeck: vi.fn(async () => {
          throw failure;
        }),
      }),
      { path: '/ankify/setup?checkout=success' }
    );

    await waitFor(() =>
      expect(reportClientError).toHaveBeenCalledWith(failure, {
        surface: 'held_deck_claim_after_checkout',
      })
    );
  });

  test('waits for the plan before looking for a saved deck', async () => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(false));
    const getHeldDeck = vi.fn(async () => null);

    renderSetup(makeBackend({ getHeldDeck, claimHeldDeck: vi.fn() }), {
      path: '/ankify/setup?checkout=success',
    });

    await waitFor(() => expect(getUserLocals).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getHeldDeck).not.toHaveBeenCalled();
  });

  test('claims nothing on a visit that is not a checkout return', async () => {
    vi.mocked(getUserLocals).mockResolvedValue(localsWith(true));
    const getHeldDeck = vi.fn(async () => ({
      cardCount: 0,
      cardsHeldBack: 40,
    }));
    const claimHeldDeck = vi.fn();

    renderSetup(makeBackend({ getHeldDeck, claimHeldDeck }));

    await screen.findByRole('button', { name: /start anki/i });
    expect(getHeldDeck).not.toHaveBeenCalled();
    expect(claimHeldDeck).not.toHaveBeenCalled();
  });
});
