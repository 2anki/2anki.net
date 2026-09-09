import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import CustomerSignalsTab from './CustomerSignalsTab';
import {
  CustomerSignalRow,
  CustomerSignalsResponse,
} from './customerSignalsTypes';
import { OpsWindow, OpsWindowContext } from './opsWindow';

const renderTab = (window: OpsWindow = '30d') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OpsWindowContext.Provider value={window}>
        <CustomerSignalsTab />
      </OpsWindowContext.Provider>
    </QueryClientProvider>
  );
};

const mockFetch = (payload: CustomerSignalsResponse) => {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  });
};

const response = (signals: CustomerSignalRow[]): CustomerSignalsResponse => ({
  signals,
  since: '2026-06-01T00:00:00.000Z',
  as_of: '2026-06-30T00:00:00.000Z',
});

const dataRowLabels = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[1].textContent);

describe('CustomerSignalsTab', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('renders convergence, stream, and bucket for each signal', async () => {
    mockFetch(
      response([
        {
          source: 'behavioral_dropoff',
          label: 'Conversions that finished with 0 cards',
          count: 12450,
          bucket: 'pain-killer',
          stream: 'behavioral',
          convergence: 2,
        },
      ])
    );

    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText('Conversions that finished with 0 cards')
      ).toBeInTheDocument()
    );

    const dataRow = screen.getAllByRole('row')[1];
    const cells = within(dataRow).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('Behavioral drop-off');
    expect(cells[2]).toHaveTextContent('12 450');
    expect(cells[3]).toHaveTextContent('2×');
    expect(cells[4]).toHaveTextContent('Behavioral');
    expect(cells[5]).toHaveTextContent('Pain killer');
  });

  test('filters the table to a single bucket', async () => {
    mockFetch(
      response([
        {
          source: 'behavioral_dropoff',
          label: 'Signed up without starting an upload',
          count: 80,
          bucket: 'money-multiplier',
          stream: 'behavioral',
          convergence: 1,
        },
        {
          source: 'failed_conversion',
          label: 'Notion export unreadable',
          count: 40,
          bucket: 'pain-killer',
          stream: 'behavioral',
          convergence: 1,
        },
      ])
    );

    renderTab();

    await waitFor(() =>
      expect(screen.getByText('Notion export unreadable')).toBeInTheDocument()
    );

    fireEvent.change(screen.getByLabelText('Bucket'), {
      target: { value: 'money-multiplier' },
    });

    expect(
      screen.getByText('Signed up without starting an upload')
    ).toBeInTheDocument();
    expect(screen.queryByText('Notion export unreadable')).toBeNull();
  });

  test('re-sorts by raw count when the sort control changes', async () => {
    mockFetch(
      response([
        {
          source: 'cancel_reason',
          label: 'converged pain',
          count: 5,
          bucket: 'unknown',
          stream: 'revenue',
          convergence: 3,
        },
        {
          source: 'failed_conversion',
          label: 'high volume',
          count: 900,
          bucket: 'pain-killer',
          stream: 'behavioral',
          convergence: 1,
        },
      ])
    );

    renderTab();

    await waitFor(() =>
      expect(screen.getByText('converged pain')).toBeInTheDocument()
    );
    expect(dataRowLabels()).toEqual(['converged pain', 'high volume']);

    fireEvent.change(screen.getByLabelText('Sort'), {
      target: { value: 'count' },
    });

    expect(dataRowLabels()).toEqual(['high volume', 'converged pain']);
  });

  test('shows the verbatim sample quote for free-text sources', async () => {
    mockFetch(
      response([
        {
          source: 'cancel_comment',
          label: 'too expensive',
          count: 1,
          bucket: 'unknown',
          stream: 'said',
          convergence: 2,
          sampleQuote: 'wish it were cheaper for students',
        },
      ])
    );

    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText('wish it were cheaper for students')
      ).toBeInTheDocument()
    );
    expect(screen.getByText('Cancellation comment')).toBeInTheDocument();
  });

  test('shows the empty state when there is no signal', async () => {
    mockFetch(response([]));

    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText('No customer signal in this window yet.')
      ).toBeInTheDocument()
    );
  });

  test('reads the shared ops window and keeps only bucket and sort controls', async () => {
    mockFetch(response([]));

    renderTab('7d');

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/ops/growth/customer-signals?window=7d',
        expect.objectContaining({ credentials: 'include' })
      )
    );
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  });

  test('renders the server error message in the danger banner', async () => {
    mockFetch({
      signals: null,
      since: '2026-06-01T00:00:00.000Z',
      as_of: '2026-06-30T00:00:00.000Z',
      error: 'relation "cancellation_feedback" does not exist',
    });

    renderTab();

    await waitFor(() =>
      expect(
        screen.getByText('relation "cancellation_feedback" does not exist')
      ).toBeInTheDocument()
    );
    expect(
      screen.queryByText('No customer signal in this window yet.')
    ).toBeNull();
  });
});
