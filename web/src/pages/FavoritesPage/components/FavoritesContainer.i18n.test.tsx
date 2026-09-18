import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import i18n from '../../../lib/i18n';
import deCommon from '../../../lib/i18n/locales/de/common.json';
import Backend from '../../../lib/backend';
import FavoritesContainer from './FavoritesContainer';

describe('FavoritesContainer in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates the page title and subtitle', async () => {
    const backend = {
      getFavorites: vi.fn().mockResolvedValue([]),
    } as unknown as Backend;
    render(
      <MemoryRouter>
        <FavoritesContainer backend={backend} setError={vi.fn()} />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole('heading', { name: deCommon.nav.favorites })
    ).toBeInTheDocument();
    expect(deCommon.nav.favorites).not.toBe('Favorites');
    expect(
      screen.getByText(deCommon.favoritesPage.subtitle)
    ).toBeInTheDocument();
  });
});
