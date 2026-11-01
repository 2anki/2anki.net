import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { SearchPage } from './SearchPage';
import { UserNotice } from '../../lib/errors/UserNotice';

const mockUseNotionData = vi.fn();

vi.mock('./helpers/useNotionData', () => ({
  default: () => mockUseNotionData(),
}));

const searchContainerProps: { setError?: (error: unknown) => void } = {};
vi.mock('./components/SearchContainer', () => ({
  default: (props: { setError: (error: unknown) => void }) => {
    searchContainerProps.setError = props.setError;
    return <div data-testid="search-container" />;
  },
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

describe('SearchPage when Notion rejects the token mid-search', () => {
  it('re-reads the connection so Connect Notion replaces the search box', () => {
    const refetch = vi.fn();
    mockUseNotionData.mockReturnValue({
      connected: true,
      connectionLink: '/api/notion/connect',
      error: null,
      loading: false,
      refetch,
      workSpace: 'Workspace',
    });
    mockUseUserLocals.mockReturnValue({
      data: { user: { id: 1 }, locals: { patreon: true, subscriber: true } },
    } as unknown);
    mockUseCardUsage.mockReturnValue(null);
    const setError = vi.fn();
    render(
      <MemoryRouter>
        <SearchPage setError={setError} />
      </MemoryRouter>
    );

    const dead = new UserNotice('API token is invalid.', 'notion_unauthorized');
    searchContainerProps.setError?.(dead);

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith(dead);
  });

  it('leaves the connection alone for other search errors', () => {
    const refetch = vi.fn();
    mockUseNotionData.mockReturnValue({
      connected: true,
      connectionLink: '/api/notion/connect',
      error: null,
      loading: false,
      refetch,
      workSpace: 'Workspace',
    });
    render(
      <MemoryRouter>
        <SearchPage setError={vi.fn()} />
      </MemoryRouter>
    );

    searchContainerProps.setError?.(new Error('Failed to fetch'));

    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('SearchPage Notion connect links', () => {
  const START_PATH = '/api/notion/connect/init';

  beforeEach(() => {
    mockUseUserLocals.mockReturnValue({ data: undefined } as unknown);
    mockUseCardUsage.mockReturnValue(null as unknown);
  });

  it('points Connect to Notion at the same-origin start path the server handed back', () => {
    mockUseNotionData.mockReturnValue({
      connected: false,
      connectionLink: START_PATH,
      error: null,
      loading: false,
      refetch: vi.fn(),
      workSpace: null,
    });

    render(
      <MemoryRouter>
        <SearchPage setError={vi.fn()} />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('link', { name: 'Connect to Notion' })
    ).toHaveAttribute('href', START_PATH);
  });

  it('points Switch workspace at the same start path', () => {
    mockUseNotionData.mockReturnValue({
      connected: true,
      connectionLink: START_PATH,
      error: null,
      loading: false,
      refetch: vi.fn(),
      workSpace: 'Workspace',
    });

    render(
      <MemoryRouter>
        <SearchPage setError={vi.fn()} />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('link', { name: 'Switch workspace' })
    ).toHaveAttribute('href', START_PATH);
  });
});
