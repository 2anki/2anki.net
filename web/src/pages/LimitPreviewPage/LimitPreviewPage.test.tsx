import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import LimitPreviewPage from './LimitPreviewPage';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

describe('LimitPreviewPage', () => {
  it('renders both section orders and the error and redirecting states', () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <LimitPreviewPage />
        </MemoryRouter>
      </HelmetProvider>
    );

    const labels = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)
      .filter((text) => text?.match(/^[AB] — /));

    expect(labels).toEqual([
      'A — passes first (previous order)',
      'B — Unlimited first',
      'A — Semester redirecting',
      'B — Semester redirecting',
      'A — checkout error',
      'B — checkout error',
    ]);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });
});
