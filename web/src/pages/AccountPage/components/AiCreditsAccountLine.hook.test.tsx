import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../../../lib/i18n';

vi.mock('../../../lib/backend/getAiCredits', () => ({
  getAiCredits: vi.fn(),
}));
vi.mock('../../../lib/hooks/useUserLocals', () => ({
  useUserLocals: vi.fn(),
}));
vi.mock('../../../lib/analytics/track', () => ({ track: vi.fn() }));

import {
  AiCreditsResponse,
  getAiCredits,
} from '../../../lib/backend/getAiCredits';
import { useUserLocals } from '../../../lib/hooks/useUserLocals';
import { AiCreditsAccountLine } from './AiCreditsAccountLine';

function signedInAs(id: number) {
  vi.mocked(useUserLocals).mockReturnValue({
    data: { user: { id } },
    isLoading: false,
    error: null,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useUserLocals>);
}

function balance(credits: number): AiCreditsResponse {
  return {
    credits,
    used: 0,
    allowance: 1500,
    usable: true,
    windowEnd: null,
    resets: 'pass',
  };
}

function renderLine() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <AiCreditsAccountLine />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, rerenderLine: () => view.rerender(tree()) };
}

describe('AiCreditsAccountLine on the live credits hook', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.resetAllMocks();
    signedInAs(7);
  });

  it("shows the signed-in account's balance", async () => {
    vi.mocked(getAiCredits).mockResolvedValue(balance(1347));

    renderLine();

    expect(await screen.findByText('1347 AI credits.')).toBeInTheDocument();
  });

  it("shows the next account's balance, never the last one's, once another account signs in", async () => {
    vi.mocked(getAiCredits)
      .mockResolvedValueOnce(balance(1347))
      .mockResolvedValueOnce(balance(12));
    const { rerenderLine } = renderLine();
    await screen.findByText('1347 AI credits.');

    signedInAs(9);
    rerenderLine();

    expect(screen.queryByText('1347 AI credits.')).toBeNull();
    expect(await screen.findByText('12 AI credits.')).toBeInTheDocument();
  });
});
