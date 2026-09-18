import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RulesPage from './RulesPage';
import { CardOptionsForm } from '../../components/CardOptionsForm/CardOptionsForm';

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => mockApi,
}));

vi.mock('../../components/CardOptionsForm/CardOptionsForm', () => ({
  CardOptionsForm: vi.fn((_props: unknown, _ref: unknown) => (
    <div data-testid="card-options-form" />
  )),
}));

const mockApi = {
  getRules: vi.fn(),
  getFavorites: vi.fn(),
  deleteRules: vi.fn(),
  deleteSettings: vi.fn(),
  addFavorite: vi.fn(),
  deleteFavorite: vi.fn(),
  saveRules: vi.fn(),
};

function renderPage(id = 'page-abc', search = '') {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/rules/${id}${search}`]}>
        <Routes>
          <Route
            path="/rules/:id"
            element={<RulesPage setErrorMessage={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('RulesPage meta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getRules.mockResolvedValue(null);
    mockApi.getFavorites.mockResolvedValue([]);
  });

  it('renders a noindex meta tag so bots do not index the parser-rules editor', () => {
    renderPage();
    const meta = document.querySelector('meta[name="robots"]');
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('noindex, nofollow');
  });
});

describe('RulesPage page title handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getRules.mockResolvedValue(null);
    mockApi.getFavorites.mockResolvedValue([]);
  });

  function lastFormPageTitle(): unknown {
    const calls = vi.mocked(CardOptionsForm).mock.calls;
    const props = calls.at(-1)?.[0] as { pageTitle?: string | null };
    return props.pageTitle;
  }

  it('hands the card options form no page title when the URL carries none', async () => {
    renderPage('page-abc');
    await waitFor(() =>
      expect(screen.getByTestId('card-options-form')).toBeInTheDocument()
    );

    expect(lastFormPageTitle() ?? null).toBeNull();
  });

  it('hands the card options form the title from the URL', async () => {
    renderPage('page-abc', '?title=HTML%20test');
    await waitFor(() =>
      expect(screen.getByTestId('card-options-form')).toBeInTheDocument()
    );

    expect(lastFormPageTitle()).toBe('HTML test');
  });
});

describe('RulesPage reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getRules.mockResolvedValue(null);
    mockApi.getFavorites.mockResolvedValue([]);
    mockApi.deleteRules.mockResolvedValue(undefined);
    mockApi.deleteSettings.mockResolvedValue(undefined);
  });

  it('shows the Reset to defaults button', async () => {
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Reset to defaults' })
      ).toBeInTheDocument();
    });
  });

  it('calls deleteRules and deleteSettings when Reset to defaults is clicked', async () => {
    renderPage('page-xyz');
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Reset to defaults' })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

    await waitFor(() => {
      expect(mockApi.deleteRules).toHaveBeenCalledWith('page-xyz');
      expect(mockApi.deleteSettings).toHaveBeenCalledWith('page-xyz');
    });
  });
});

describe('RulesPage deck boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getRules.mockResolvedValue(null);
    mockApi.getFavorites.mockResolvedValue([]);
    mockApi.saveRules.mockResolvedValue(undefined);
  });

  it('renders a Deck boundaries label so users can configure which blocks start a deck', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Deck boundaries')).toBeInTheDocument();
    });
  });

  it('persists the deck-types selection when the user clicks Save changes', async () => {
    renderPage('page-deck-select');
    await waitFor(() => {
      expect(screen.getByText('Deck boundaries')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'database' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mockApi.saveRules).toHaveBeenCalled();
    });
    const call = mockApi.saveRules.mock.calls[0];
    expect(call[0]).toBe('page-deck-select');
    expect(call[2]).toEqual(['page']);
  });

  it('falls back to the defaults when the user has deselected every deck type', async () => {
    renderPage('page-deck-empty');
    await waitFor(() => {
      expect(screen.getByText('Deck boundaries')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'page' }));
    fireEvent.click(screen.getByRole('button', { name: 'database' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mockApi.saveRules).toHaveBeenCalled();
    });
    const call = mockApi.saveRules.mock.calls[0];
    expect(call[2]).toEqual(['page', 'database']);
  });

  it('loads the saved deck-types from a stored rule', async () => {
    mockApi.getRules.mockResolvedValue({
      id: 1,
      object_id: 'page-loaded',
      flashcard_is: 'toggle',
      sub_deck_is: 'child_page',
      tags_is: 'strikethrough',
      deck_is: 'database',
      owner: 1,
      email_notification: false,
    });
    renderPage('page-loaded');
    await waitFor(() => {
      expect(screen.getByText('Deck boundaries')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(mockApi.saveRules).toHaveBeenCalled();
    });
    const call = mockApi.saveRules.mock.calls[0];
    expect(call[2]).toEqual(['database']);
  });
});

describe('RulesPage advanced deck types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getRules.mockResolvedValue(null);
    mockApi.getFavorites.mockResolvedValue([]);
    mockApi.saveRules.mockResolvedValue(undefined);
  });

  it('keeps the advanced disclosure collapsed by default', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Deck boundaries')).toBeInTheDocument();
    });
    const summary = screen.getByText('Advanced deck types');
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
  });

  it('opens the disclosure on load when a saved advanced type is present', async () => {
    mockApi.getRules.mockResolvedValue({
      id: 2,
      object_id: 'page-advanced',
      flashcard_is: 'toggle',
      sub_deck_is: 'child_page',
      tags_is: 'strikethrough',
      deck_is: 'page,database,toggle',
      owner: 1,
      email_notification: false,
    });
    renderPage('page-advanced');
    await waitFor(() => {
      expect(screen.getByText('Deck boundaries')).toBeInTheDocument();
    });
    const details = screen.getByText('Advanced deck types').closest('details');
    expect(details).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Toggle' })).toBeInTheDocument();
  });

  it('adds an advanced block type to deck_is when its chip is toggled', async () => {
    mockApi.getRules.mockResolvedValue({
      id: 3,
      object_id: 'page-advanced-toggle',
      flashcard_is: 'toggle',
      sub_deck_is: 'child_page',
      tags_is: 'strikethrough',
      deck_is: 'page,database,toggle',
      owner: 1,
      email_notification: false,
    });
    renderPage('page-advanced-toggle');
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Heading 1' })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Heading 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mockApi.saveRules).toHaveBeenCalled();
    });
    const call = mockApi.saveRules.mock.calls[0];
    expect(call[2]).toEqual(['page', 'database', 'toggle', 'heading_1']);
  });

  it('hides the re-split warning when no advanced type is selected', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Deck boundaries')).toBeInTheDocument();
    });
    expect(screen.queryByText(/re-split this page/i)).toBeNull();
  });

  it('shows the re-split warning when a saved advanced type is present', async () => {
    mockApi.getRules.mockResolvedValue({
      id: 4,
      object_id: 'page-warn',
      flashcard_is: 'toggle',
      sub_deck_is: 'child_page',
      tags_is: 'strikethrough',
      deck_is: 'page,database,toggle',
      owner: 1,
      email_notification: false,
    });
    renderPage('page-warn');
    await waitFor(() => {
      expect(screen.getByText(/re-split this page/i)).toBeInTheDocument();
    });
  });

  it('shows the re-split warning after a user turns on an advanced type', async () => {
    mockApi.getRules.mockResolvedValue({
      id: 5,
      object_id: 'page-warn-toggle',
      flashcard_is: 'toggle',
      sub_deck_is: 'child_page',
      tags_is: 'strikethrough',
      deck_is: 'page,database,toggle',
      owner: 1,
      email_notification: false,
    });
    renderPage('page-warn-toggle');
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Toggle' })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    await waitFor(() => {
      expect(screen.queryByText(/re-split this page/i)).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Quote' }));
    await waitFor(() => {
      expect(screen.getByText(/re-split this page/i)).toBeInTheDocument();
    });
  });
});
