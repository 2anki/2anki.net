import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import LimitPreviewPage from './LimitPreviewPage';

describe('LimitPreviewPage', () => {
  it('renders the wall with and without a Pro price, redirecting, and in error', () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <LimitPreviewPage />
        </MemoryRouter>
      </HelmetProvider>
    );

    const labels = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);

    expect(labels).toEqual([
      'Passes first, Pro price known',
      'Passes first, no Pro price',
      'Semester redirecting',
      'Checkout error',
    ]);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
