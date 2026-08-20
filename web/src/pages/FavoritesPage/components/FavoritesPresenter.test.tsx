import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import FavoritesPresenter from './FavoritesPresenter';

function renderPresenter(favorites: any[] = []) {
  return render(
    <MemoryRouter>
      <FavoritesPresenter
        favorites={favorites}
        setError={vi.fn()}
        setFavorites={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe('FavoritesPresenter', () => {
  it('shows the empty message when there are no favorites', () => {
    renderPresenter([]);
    expect(screen.getByText('No favorites yet.')).toBeInTheDocument();
  });

  it('renders the favorites list when favorites exist', () => {
    renderPresenter([
      {
        object: 'page',
        title: 'Biology',
        url: 'https://notion.so/x',
        id: 'page-1',
      } as any,
    ]);
    expect(screen.queryByText('No favorites yet.')).not.toBeInTheDocument();
  });
});
