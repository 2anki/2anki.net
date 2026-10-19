import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import i18n from '../../lib/i18n';
import RulesPage from './RulesPage';

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => mockApi,
}));

vi.mock('../../components/CardOptionsForm/CardOptionsForm', () => ({
  CardOptionsForm: vi.fn(() => <div data-testid="card-options-form" />),
}));

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({ data: { locals: { subscriber: false } } }),
}));

const mockApi = {
  getRules: vi.fn(async () => null),
  getFavorites: vi.fn(async () => []),
  deleteRules: vi.fn(),
  deleteSettings: vi.fn(),
  addFavorite: vi.fn(),
  deleteFavorite: vi.fn(),
  saveRules: vi.fn(),
};

describe('RulesPage in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the sections and save bar', async () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/rules/page-abc']}>
          <Routes>
            <Route
              path="/rules/:id"
              element={<RulesPage setErrorMessage={vi.fn()} />}
            />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    );
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Stapel und Unterstapel' })
      ).toBeInTheDocument()
    );
    expect(
      screen.getByRole('button', { name: 'Änderungen speichern' })
    ).toBeInTheDocument();
  });
});
