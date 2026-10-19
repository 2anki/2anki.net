import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
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

vi.mock('../../lib/analytics/reportPurchaseConversion', () => ({
  reportPurchaseConversion: vi.fn(),
  replayPendingPurchaseConversions: vi.fn(),
}));

import { getUserLocals } from '../../lib/backend/getUserLocals';

const localsWith = (autoSyncActive: boolean | undefined) =>
  ({
    user: { id: 7, email: 'learner@example.com' },
    locals: {
      owner: 42,
      patreon: false,
      subscriber: false,
      subscriptionInfo: { active: false, email: '', linked_email: '' },
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

const renderSetup = (backend: Backend) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ankify/setup']}>
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
