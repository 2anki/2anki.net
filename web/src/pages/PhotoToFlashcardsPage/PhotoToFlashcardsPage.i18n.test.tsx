import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '../../lib/i18n';
import { PhotoToFlashcardsPage } from './PhotoToFlashcardsPage';

vi.mock('../../lib/analytics/track', () => ({
  track: vi.fn(),
}));

const mockUseUserLocals = vi.fn();
vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => mockUseUserLocals(),
}));

describe('PhotoToFlashcardsPage in German', () => {
  beforeEach(async () => {
    mockUseUserLocals.mockReturnValue({
      data: { locals: { email: 'test@example.com' } },
    });
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the header and mode cards', () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <PhotoToFlashcardsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(
      screen.getByRole('heading', { name: 'Foto zu Stapel' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Karten erstellen' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Vorhandene Fragen übernehmen' })
    ).toBeInTheDocument();
    expect(screen.getByText('Foto aufnehmen')).toBeInTheDocument();
  });
});
