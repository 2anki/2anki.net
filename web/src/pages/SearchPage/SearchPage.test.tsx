import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { SearchPage } from './SearchPage';

const mockUseNotionData = vi.fn();

vi.mock('./helpers/useNotionData', () => ({
  default: () => mockUseNotionData(),
}));

vi.mock('./components/SearchContainer', () => ({
  default: () => <div data-testid="search-container" />,
}));

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ startPassCheckout: vi.fn() }),
}));

const mockUseUserLocals = vi.fn(() => ({ data: undefined }) as unknown);
vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => mockUseUserLocals(),
}));

const mockUseCardUsage = vi.fn(() => null as unknown);
vi.mock('../../lib/hooks/useCardUsage', () => ({
  useCardUsage: () => mockUseCardUsage(),
  CARD_USAGE_QUERY_KEY: ['cardUsage'],
}));

vi.mock('../../lib/hooks/usePassPrices', () => ({
  usePassPrices: () => ({ '24h': '$6', '7d': '$12', '120d': '$29' }),
}));

describe('SearchPage over the monthly limit', () => {
  beforeEach(() => {
    mockUseNotionData.mockReturnValue({
      connected: true,
      connectionLink: '/api/notion/connect',
      error: null,
      loading: false,
      refetch: vi.fn(),
      workSpace: 'Workspace',
    });
    mockUseUserLocals.mockReturnValue({
      data: { user: { id: 1 }, locals: { patreon: false, subscriber: false } },
    } as unknown);
    mockUseCardUsage.mockReturnValue({
      cards_used: 181,
      cards_limit: 100,
      unlimited: false,
      loading: false,
    } as unknown);
  });

  it('locks the page and hides the search container when over the limit', () => {
    render(
      <MemoryRouter>
        <SearchPage setError={vi.fn()} />
      </MemoryRouter>
    );
    expect(
      screen.getByText("You've used all 100 cards this month")
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Get Day Pass/ })
    ).toBeInTheDocument();
    expect(screen.queryByTestId('search-container')).not.toBeInTheDocument();
  });
});

describe('SearchPage Hotjar suppression', () => {
  beforeEach(() => {
    mockUseUserLocals.mockReturnValue({ data: undefined } as unknown);
    mockUseCardUsage.mockReturnValue(null as unknown);
    mockUseNotionData.mockReturnValue({
      connected: true,
      connectionLink: '/api/notion/connect',
      error: null,
      loading: false,
      refetch: vi.fn(),
      workSpace: 'Pristine’s Notion',
    });
  });

  it('suppresses the connected workspace name from Hotjar recordings', () => {
    render(<SearchPage setError={vi.fn()} />);

    expect(screen.getByText('Pristine’s Notion')).toHaveAttribute(
      'data-hj-suppress'
    );
  });
});
