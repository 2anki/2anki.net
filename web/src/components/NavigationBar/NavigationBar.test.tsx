import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NavigationBar from './NavigationBar';
import { getAiGift } from '../../lib/backend/aiGift';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

vi.mock('../../lib/backend/aiGift', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/backend/aiGift')>()),
  getAiGift: vi.fn(),
}));

function renderBar(isLoggedIn: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NavigationBar isLoggedIn={isLoggedIn} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.mocked(getAiGift).mockReset();
  vi.mocked(getAiGift).mockResolvedValue({
    state: 'open',
    credits: 100,
    hasCredits: true,
    validDays: 7,
    endsAt: '2026-12-04T22:00:00.000Z',
    feedbackDue: false,
  });
});

describe('NavigationBar free AI credits pill', () => {
  it('shows the credits pill to a signed-in account with gift credits', async () => {
    renderBar(true);

    expect(await screen.findByText('100 credits')).toBeInTheDocument();
  });

  it('shows a signed-out visitor no pill and asks for no gift status', async () => {
    renderBar(false);

    await waitFor(() =>
      expect(screen.getByRole('navigation')).toBeInTheDocument()
    );
    expect(screen.queryByText('100 credits')).toBeNull();
    expect(getAiGift).not.toHaveBeenCalled();
  });
});
