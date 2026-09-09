import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, test } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import OpsLayout from './OpsLayout';
import { useOpsWindow } from './opsWindow';

function WindowProbe() {
  const window = useOpsWindow();
  const location = useLocation();
  return (
    <div>
      <span data-testid="window">{window}</span>
      <span data-testid="search">{location.search}</span>
    </div>
  );
}

const renderAt = (path: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/ops" element={<OpsLayout />}>
            <Route index element={<div data-testid="engineering">eng</div>} />
            <Route
              path="business"
              element={<div data-testid="business">biz</div>}
            />
            <Route path="growth" element={<WindowProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('OpsLayout', () => {
  test('renders the Ops heading and the active section breadcrumb', () => {
    renderAt('/ops');
    expect(screen.getByRole('heading', { name: 'Ops' })).toBeInTheDocument();
    const section = screen.getByText('Today');
    expect(section).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('engineering')).toBeInTheDocument();
  });

  test('shows the Business section name on /ops/business', () => {
    renderAt('/ops/business');
    expect(screen.getByText('Business')).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
    expect(screen.getByTestId('business')).toBeInTheDocument();
  });

  test('no longer renders an in-page tab bar', () => {
    renderAt('/ops');
    expect(
      screen.queryByRole('link', { name: 'Business' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Ops sections' })
    ).not.toBeInTheDocument();
  });

  test('defaults the shared window to 30d and offers 7d, 30d, 90d', () => {
    renderAt('/ops/growth');
    const group = screen.getByRole('group', { name: 'Window' });
    expect(group).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Last 30 days' })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(
      screen.getByRole('button', { name: 'Last 90 days' })
    ).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('window')).toHaveTextContent('30d');
  });

  test('reads the window from the URL and ignores values outside the vocabulary', () => {
    renderAt('/ops/growth?window=90d');
    expect(screen.getByTestId('window')).toHaveTextContent('90d');
    expect(
      screen.getByRole('button', { name: 'Last 90 days' })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('falls back to 30d for a window outside the vocabulary', () => {
    renderAt('/ops/growth?window=24h');
    expect(screen.getByTestId('window')).toHaveTextContent('30d');
  });

  test('changing the window updates the URL and the shared context', () => {
    renderAt('/ops/growth?eng_window=1h');
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    expect(screen.getByTestId('window')).toHaveTextContent('7d');
    expect(screen.getByTestId('search')).toHaveTextContent(
      'eng_window=1h&window=7d'
    );
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('renders one freshness line with a Refresh button', () => {
    renderAt('/ops');
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });
});
