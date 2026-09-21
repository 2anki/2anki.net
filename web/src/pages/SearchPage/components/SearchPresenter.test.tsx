import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type NotionObject from '../../../lib/interfaces/NotionObject';
import SearchPresenter from './SearchPresenter';

vi.mock('../helpers/useFavorites', () => ({
  default: () => [[], vi.fn()],
}));

const SHARING_HELP =
  'Showing top-level pages shared with 2anki. Missing a page? Check your Notion sharing settings.';

const sharedPage: NotionObject = {
  id: 'page-1',
  title: 'A shared page',
  object: 'page',
  url: 'https://notion.so/page-1',
};

function renderPresenter(overrides: {
  searchQuery: string;
  myPages: NotionObject[];
}) {
  return render(
    <MemoryRouter>
      <SearchPresenter
        inProgress={false}
        myPages={overrides.myPages}
        setSearchQuery={vi.fn()}
        searchQuery={overrides.searchQuery}
        triggerSearch={vi.fn()}
        setError={vi.fn()}
        workSpace={null}
        isLoggedIn
      />
    </MemoryRouter>
  );
}

describe('SearchPresenter sharing note', () => {
  it('explains the list when the box is empty and pages are shown', () => {
    renderPresenter({ searchQuery: '', myPages: [sharedPage] });

    expect(screen.getByText(SHARING_HELP)).toBeInTheDocument();
  });

  it('stays out of the way once the user types a search', () => {
    renderPresenter({ searchQuery: 'shared', myPages: [sharedPage] });

    expect(screen.queryByText(SHARING_HELP)).not.toBeInTheDocument();
  });

  it('leaves the empty state to explain itself when nothing is shared', () => {
    renderPresenter({ searchQuery: '', myPages: [] });

    expect(screen.queryByText(SHARING_HELP)).not.toBeInTheDocument();
  });
});
