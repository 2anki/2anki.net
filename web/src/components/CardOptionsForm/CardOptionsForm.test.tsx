import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CardOptionsForm } from './CardOptionsForm';
import CardOptionModel from '../../lib/data_layer/model/CardOption';

const mockResetUserCardOptions = vi.fn();
const mockGetSettingsCardOptions = vi.fn();
const mockUseUserLocals = vi.fn();
const mockSaveSettings = vi.fn();
const mockGetSettings = vi.fn();
const mockTrack = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    resetUserCardOptions: mockResetUserCardOptions,
    deleteSettings: vi.fn().mockResolvedValue(undefined),
    saveSettings: (...args: unknown[]) => mockSaveSettings(...args),
    getSettings: (...args: unknown[]) => mockGetSettings(...args),
  }),
}));

vi.mock('../../lib/backend/getSettingsCardOptions', () => ({
  getSettingsCardOptions: () => mockGetSettingsCardOptions(),
}));

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => mockUseUserLocals(),
}));

vi.mock('../../lib/backend/templates', () => ({
  getUserTemplates: vi.fn().mockResolvedValue({ templates: [], hiddenIds: [] }),
  getOfficialNoteTypes: vi.fn().mockResolvedValue([]),
  getDefaultNoteTypes: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

function setUserLocalsPaying(paying: boolean) {
  mockUseUserLocals.mockReturnValue({
    data: paying
      ? { locals: { patreon: false, subscriber: true } }
      : { locals: { patreon: false, subscriber: false } },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

function renderForm(
  isLoggedIn: boolean,
  spies: { onReset: () => void; setError: () => void }
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CardOptionsForm
          pageId={null}
          isLoggedIn={isLoggedIn}
          onReset={spies.onReset}
          setError={spies.setError}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPageForm(spies: { setError: () => void; onSaved?: () => void }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CardOptionsForm
          pageId="page-1"
          pageTitle="Pharmacology"
          isLoggedIn
          onSaved={spies.onSaved}
          setError={spies.setError}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function makeDirty() {
  const deckInput = await screen.findByPlaceholderText(
    'Enter deck name (optional)'
  );
  fireEvent.change(deckInput, { target: { value: 'Pharmacology II' } });
  return screen.findByRole('button', { name: 'Save defaults' });
}

describe('CardOptionsForm reset for the account-default view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetUserCardOptions.mockResolvedValue(undefined);
    mockGetSettingsCardOptions.mockResolvedValue([]);
    setUserLocalsPaying(false);
    localStorage.clear();
  });

  it('resets anonymous users without calling the auth-only server endpoint', async () => {
    const onReset = vi.fn();
    const setError = vi.fn();
    renderForm(false, { onReset, setError });
    const resetButton = await screen.findByRole('button', {
      name: 'Reset to defaults',
    });
    fireEvent.click(resetButton);
    await waitFor(() => {
      expect(onReset).toHaveBeenCalledTimes(1);
    });
    expect(mockResetUserCardOptions).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it('calls the server reset for logged-in users', async () => {
    const onReset = vi.fn();
    const setError = vi.fn();
    renderForm(true, { onReset, setError });
    const resetButton = await screen.findByRole('button', {
      name: 'Reset to defaults',
    });
    fireEvent.click(resetButton);
    await waitFor(() => {
      expect(mockResetUserCardOptions).toHaveBeenCalledTimes(1);
    });
    expect(setError).not.toHaveBeenCalled();
  });
});

describe('CardOptionsForm reset clears all stored card options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetUserCardOptions.mockResolvedValue(undefined);
    setUserLocalsPaying(false);
    localStorage.clear();
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOptionModel(
        'cloze',
        'Cloze deletion cards',
        'Turn code spans into cloze deletions.',
        true
      ),
    ]);
  });

  it('removes the non-checkbox card-option keys from localStorage', async () => {
    localStorage.setItem('deckName', 'Pharmacology');
    localStorage.setItem('font-size', '32');
    localStorage.setItem('template', 'custom');
    localStorage.setItem('mcq-enabled', 'true');
    localStorage.setItem('card-size', 'detailed');
    localStorage.setItem('text-color', '#ff0000');
    localStorage.setItem('toggle-mode', 'open_toggle');
    localStorage.setItem('token', 'session-keep');

    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const resetButton = await screen.findByRole('button', {
      name: 'Reset to defaults',
    });
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(localStorage.getItem('deckName')).toBeNull();
    });
    expect(localStorage.getItem('font-size')).toBeNull();
    expect(localStorage.getItem('template')).toBeNull();
    expect(localStorage.getItem('mcq-enabled')).toBeNull();
    expect(localStorage.getItem('card-size')).toBeNull();
    expect(localStorage.getItem('text-color')).toBeNull();
    expect(localStorage.getItem('toggle-mode')).toBeNull();
    expect(localStorage.getItem('token')).toBe('session-keep');
  });

  it('turns MCQ off and card size back to medium in the UI after reset', async () => {
    localStorage.setItem('mcq-enabled', 'true');
    localStorage.setItem('card-size', 'detailed');

    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });

    const mcqGroup = await screen.findByRole('group', {
      name: 'Enable multiple choice questions',
    });
    expect(within(mcqGroup).getByRole('button', { name: 'On' })).toHaveClass(
      /segmentActive/
    );

    const sizeGroup = screen.getByRole('group', { name: 'Card size' });
    expect(
      within(sizeGroup).getByRole('button', { name: 'Detailed' })
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

    await waitFor(() => {
      expect(within(mcqGroup).getByRole('button', { name: 'Off' })).toHaveClass(
        /segmentActive/
      );
    });
    expect(
      within(sizeGroup).getByRole('button', { name: 'Medium' })
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('CardOptionsForm embed-images toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetUserCardOptions.mockResolvedValue(undefined);
    setUserLocalsPaying(false);
    localStorage.clear();
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOptionModel(
        'embed-images',
        'Embed images in cards',
        'Pack image bytes into the deck so cards render offline.',
        true
      ),
    ]);
  });

  it('renders the toggle on by default and writes "false" to localStorage when unticked', async () => {
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const toggle = await screen.findByRole('checkbox', {
      name: 'Embed images in cards',
    });
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(localStorage.getItem('embed-images')).toBe('false');
    });
    expect(toggle).not.toBeChecked();
  });

  it('flipping back to on writes "true" to localStorage', async () => {
    localStorage.setItem('embed-images', 'false');
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const toggle = await screen.findByRole('checkbox', {
      name: 'Embed images in cards',
    });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(localStorage.getItem('embed-images')).toBe('true');
    });
    expect(toggle).toBeChecked();
  });
});

describe('CardOptionsForm code theme picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetUserCardOptions.mockResolvedValue(undefined);
    setUserLocalsPaying(false);
    localStorage.clear();
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOptionModel(
        'no-underline',
        'Remove underlines',
        'Strip underline formatting from card text.',
        false
      ),
    ]);
  });

  it('defaults to GitHub and writes the picked theme to localStorage', async () => {
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const select = (await screen.findByLabelText(
      'Code theme'
    )) as HTMLSelectElement;
    expect(select.value).toBe('github');

    fireEvent.change(select, { target: { value: 'dracula' } });

    await waitFor(() => {
      expect(localStorage.getItem('code-theme')).toBe('dracula');
    });
    expect(select.value).toBe('dracula');
  });

  it('offers the four documented themes', async () => {
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    await screen.findByLabelText('Code theme');
    expect(screen.getByRole('option', { name: 'GitHub' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'One Dark' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Solarized' })
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dracula' })).toBeInTheDocument();
  });
});

describe('CardOptionsForm overlapping cloze picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetUserCardOptions.mockResolvedValue(undefined);
    setUserLocalsPaying(false);
    localStorage.clear();
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOptionModel(
        'cloze',
        'Cloze deletion cards',
        'Turn code spans into cloze deletions.',
        true
      ),
    ]);
  });

  it('writes the picked style to localStorage when cloze is on', async () => {
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const showAll = await screen.findByRole('button', {
      name: 'Show the whole list',
    });
    expect(showAll).toBeEnabled();

    fireEvent.click(showAll);

    await waitFor(() => {
      expect(localStorage.getItem('overlapping-cloze')).toBe('show-all');
    });
    expect(showAll).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables the picker when cloze is turned off', async () => {
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const cloze = await screen.findByRole('checkbox', {
      name: 'Cloze deletion cards',
    });
    fireEvent.click(cloze);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Show nearby lines only' })
      ).toBeDisabled();
    });
    expect(
      screen.getAllByText('Turn on Cloze deletion cards first.').length
    ).toBeGreaterThan(0);
  });

  it('hides the preview while the style is Off and shows it once a style is picked', async () => {
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const showAll = await screen.findByRole('button', {
      name: 'Show the whole list',
    });
    expect(
      screen.queryByLabelText('Preview: each card hides one line of the list')
    ).toBeNull();

    fireEvent.click(showAll);

    await waitFor(() => {
      expect(
        screen.getByLabelText('Preview: each card hides one line of the list')
      ).toBeInTheDocument();
    });
  });
});

describe('CardOptionsForm manual TTS picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetUserCardOptions.mockResolvedValue(undefined);
    setUserLocalsPaying(false);
    localStorage.clear();
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOptionModel(
        'cloze',
        'Cloze deletion cards',
        'Turn code spans into cloze deletions.',
        true
      ),
    ]);
  });

  it('writes the picked language to localStorage and reveals the side selector', async () => {
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const langSelect = await screen.findByLabelText('Language');

    expect(screen.queryByRole('group', { name: 'Read aloud side' })).toBeNull();

    fireEvent.change(langSelect, { target: { value: 'ja_JP' } });

    await waitFor(() => {
      expect(localStorage.getItem('tts-manual-lang')).toBe('ja_JP');
    });
    expect(
      screen.getByRole('group', { name: 'Read aloud side' })
    ).toBeInTheDocument();
  });

  it('writes the picked side to localStorage', async () => {
    localStorage.setItem('tts-manual-lang', 'ja_JP');
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const bothButton = await screen.findByRole('button', { name: 'Both' });

    fireEvent.click(bothButton);

    await waitFor(() => {
      expect(localStorage.getItem('tts-manual-side')).toBe('both');
    });
    expect(bothButton).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('CardOptionsForm inline-code-toggles-become-cloze sub-option', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetUserCardOptions.mockResolvedValue(undefined);
    setUserLocalsPaying(false);
    localStorage.clear();
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOptionModel(
        'cloze',
        'Cloze deletion cards',
        'Turn code spans into cloze deletions.',
        true
      ),
      new CardOptionModel(
        'cloze-from-toggle-content',
        'Inline code toggles become cloze',
        "When a toggle's contents contain inline code, hide the code as a cloze and use the toggle header as the hint. Works only when Cloze deletion is on.",
        false
      ),
    ]);
  });

  it('renders the toggle off by default and writes "true" to localStorage when ticked', async () => {
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const toggle = await screen.findByRole('switch', {
      name: 'Inline code toggles become cloze',
    });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(localStorage.getItem('cloze-from-toggle-content')).toBe('true');
    });
    expect(toggle).toBeChecked();
  });

  it('disables the toggle when cloze is turned off', async () => {
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const cloze = await screen.findByRole('checkbox', {
      name: 'Cloze deletion cards',
    });
    fireEvent.click(cloze);

    await waitFor(() => {
      expect(
        screen.getByRole('switch', {
          name: 'Inline code toggles become cloze',
        })
      ).toBeDisabled();
    });
    expect(
      screen.getAllByText('Turn on Cloze deletion cards first.').length
    ).toBeGreaterThan(0);
  });
});

describe('CardOptionsForm section-tags toggle gated on cherry-pick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetUserCardOptions.mockResolvedValue(undefined);
    setUserLocalsPaying(false);
    localStorage.clear();
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOptionModel(
        'cherry',
        'Only convert toggles with the 🍒 emoji',
        'Cherry-pick which toggles become cards.',
        false
      ),
      new CardOptionModel(
        'section-tags',
        'Tag a whole section',
        'Strike through a line under a parent toggle to tag every card nested beneath it — tag a whole section at once. Requires Cherry-pick mode.',
        false
      ),
    ]);
  });

  it('disables the section-tags toggle and shows the prerequisite hint when cherry is off', async () => {
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const toggle = await screen.findByRole('switch', {
      name: 'Tag a whole section',
    });
    expect(toggle).toBeDisabled();
    expect(screen.getByText('Turn on Cherry-pick first.')).toBeInTheDocument();
  });

  it('enables the section-tags toggle once cherry-pick is turned on', async () => {
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const cherry = await screen.findByRole('checkbox', {
      name: 'Only convert toggles with the 🍒 emoji',
    });
    fireEvent.click(cherry);

    await waitFor(() => {
      expect(
        screen.getByRole('switch', { name: 'Tag a whole section' })
      ).toBeEnabled();
    });
    expect(screen.queryByText('Turn on Cherry-pick first.')).toBeNull();
  });

  it('round-trips the section-tags value to localStorage when cherry is on', async () => {
    localStorage.setItem('cherry', 'true');
    renderForm(false, { onReset: vi.fn(), setError: vi.fn() });
    const toggle = await screen.findByRole('switch', {
      name: 'Tag a whole section',
    });
    expect(toggle).toBeEnabled();
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(localStorage.getItem('section-tags')).toBe('true');
    });
    expect(toggle).toBeChecked();
  });
});

describe('CardOptionsForm ai-comprehensive toggle (paid-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetUserCardOptions.mockResolvedValue(undefined);
    localStorage.clear();
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOptionModel(
        'ai-comprehensive',
        'Comprehensive AI mode',
        'Aim for hundreds of cards per chapter instead of dozens. Conversions take longer. Paid plans only.',
        false
      ),
    ]);
  });

  it('renders the toggle for a paying user', async () => {
    setUserLocalsPaying(true);
    renderForm(true, { onReset: vi.fn(), setError: vi.fn() });
    const toggle = await screen.findByRole('checkbox', {
      name: 'Comprehensive AI mode',
    });
    expect(toggle).not.toBeChecked();
  });

  it('hides the toggle for a non-paying user', async () => {
    setUserLocalsPaying(false);
    renderForm(true, { onReset: vi.fn(), setError: vi.fn() });
    await screen.findByRole('button', { name: 'Reset to defaults' });
    expect(
      screen.queryByRole('checkbox', { name: 'Comprehensive AI mode' })
    ).toBeNull();
  });

  it('round-trips the toggle value to localStorage for a paying user', async () => {
    setUserLocalsPaying(true);
    renderForm(true, { onReset: vi.fn(), setError: vi.fn() });
    const toggle = await screen.findByRole('checkbox', {
      name: 'Comprehensive AI mode',
    });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(localStorage.getItem('ai-comprehensive')).toBe('true');
    });
    expect(toggle).toBeChecked();
  });

  it('shows the card-size hint only while comprehensive is checked', async () => {
    setUserLocalsPaying(true);
    renderForm(true, { onReset: vi.fn(), setError: vi.fn() });
    const toggle = await screen.findByRole('checkbox', {
      name: 'Comprehensive AI mode',
    });
    expect(screen.queryByText(/set Card size to Detailed/i)).toBeNull();

    fireEvent.click(toggle);

    const hint = await screen.findByText(/set Card size to Detailed/i);
    expect(hint).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Go to Card size' });
    expect(link).toHaveAttribute('href', '#card-size');

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.queryByText(/set Card size to Detailed/i)).toBeNull();
    });
  });
});

describe('CardOptionsForm loads a saved per-page payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUserLocalsPaying(false);
    localStorage.clear();
    mockSaveSettings.mockResolvedValue(undefined);
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOptionModel(
        'no-underline',
        'Remove underlines',
        'Strip underline formatting from card text.',
        false
      ),
    ]);
  });

  it('shows the saved deck name and code theme from a flat payload', async () => {
    mockGetSettings.mockResolvedValue({
      deckName: 'Saved Pharmacology Deck',
      'code-theme': 'dracula',
    });

    renderPageForm({ setError: vi.fn() });

    const deckInput = (await screen.findByPlaceholderText(
      'Enter deck name (optional)'
    )) as HTMLInputElement;
    await waitFor(() => {
      expect(deckInput.value).toBe('Saved Pharmacology Deck');
    });

    const codeTheme = (await screen.findByLabelText(
      'Code theme'
    )) as HTMLSelectElement;
    expect(codeTheme.value).toBe('dracula');
  });

  it('ticks a saved checkbox option from a flat payload', async () => {
    mockGetSettings.mockResolvedValue({ 'no-underline': 'true' });

    renderPageForm({ setError: vi.fn() });

    const toggle = await screen.findByRole('checkbox', {
      name: 'Remove underlines',
    });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });
  });
});

describe('CardOptionsForm save defaults feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUserLocalsPaying(false);
    localStorage.clear();
    mockGetSettingsCardOptions.mockResolvedValue([]);
    mockGetSettings.mockResolvedValue({});
    mockSaveSettings.mockResolvedValue(undefined);
  });

  it('disables the button and shows Saving while the save is in flight', async () => {
    let resolveSave: () => void = () => {};
    mockSaveSettings.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      })
    );
    renderPageForm({ setError: vi.fn() });
    const saveButton = await makeDirty();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled();
    });

    resolveSave();
  });

  it('shows a Defaults saved status that survives the button unmounting', async () => {
    renderPageForm({ setError: vi.fn() });
    const saveButton = await makeDirty();

    fireEvent.click(saveButton);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Defaults saved');
    expect(screen.queryByRole('button', { name: 'Save defaults' })).toBeNull();

    await waitFor(
      () => {
        expect(screen.queryByRole('status')).toBeNull();
      },
      { timeout: 4000 }
    );
  });

  it('shows an inline error and keeps the button enabled when the save fails', async () => {
    const setError = vi.fn();
    mockSaveSettings.mockRejectedValue(new Error('network down'));
    renderPageForm({ setError });
    const saveButton = await makeDirty();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't save your defaults. Try again."
      );
    });
    expect(setError).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save defaults' })).toBeEnabled();
  });

  it('saves once when the button is clicked twice in quick succession', async () => {
    let resolveSave: () => void = () => {};
    mockSaveSettings.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      })
    );
    renderPageForm({ setError: vi.fn() });
    const saveButton = await makeDirty();

    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    });

    resolveSave();
  });

  it('does not show the saved status when onSaved navigates away', async () => {
    const onSaved = vi.fn();
    renderPageForm({ setError: vi.fn(), onSaved });
    const saveButton = await makeDirty();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('CardOptionsForm user instructions disclosure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetUserCardOptions.mockResolvedValue(undefined);
    setUserLocalsPaying(false);
    globalThis.localStorage.clear();
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOptionModel(
        'claude-ai-flashcards',
        'AI flashcards',
        'Write the cards with Claude.',
        false
      ),
    ]);
    window.location.hash = '';
  });

  it('opens the instructions box when arriving at the pdf-ai anchor', async () => {
    window.location.hash = '#pdf-ai';
    renderForm(true, { onReset: vi.fn(), setError: vi.fn() });
    const summary = await screen.findByText(/instructions/i, {
      selector: 'summary',
    });
    expect(summary.closest('details')).toHaveAttribute('open');
  });

  it('keeps the instructions box collapsed without the anchor', async () => {
    renderForm(true, { onReset: vi.fn(), setError: vi.fn() });
    const summary = await screen.findByText(/instructions/i, {
      selector: 'summary',
    });
    expect(summary.closest('details')).not.toHaveAttribute('open');
  });
});

describe('CardOptionsForm card style picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResetUserCardOptions.mockResolvedValue(undefined);
    setUserLocalsPaying(false);
    globalThis.localStorage.clear();
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOptionModel(
        'claude-ai-flashcards',
        'AI flashcards',
        'Write the cards with Claude.',
        false
      ),
    ]);
  });

  it('renders the four card style options', async () => {
    renderForm(true, { onReset: vi.fn(), setError: vi.fn() });
    const select = await screen.findByLabelText('Card style');
    const labels = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(labels).toEqual([
      'Automatic',
      'Cloze',
      'Question and answer',
      'By heading',
    ]);
  });

  it('defaults to Automatic', async () => {
    renderForm(true, { onReset: vi.fn(), setError: vi.fn() });
    const select = await screen.findByLabelText('Card style');
    expect(select).toHaveValue('');
  });

  it('writes the picked style to localStorage on change', async () => {
    renderForm(true, { onReset: vi.fn(), setError: vi.fn() });
    const select = await screen.findByLabelText('Card style');
    fireEvent.change(select, { target: { value: 'heading-driven' } });
    expect(localStorage.getItem('card-style')).toBe('heading-driven');
    expect(select).toHaveValue('heading-driven');
  });

  it('fires the card_style_selected event with the chosen style', async () => {
    renderForm(true, { onReset: vi.fn(), setError: vi.fn() });
    const select = await screen.findByLabelText('Card style');
    fireEvent.change(select, { target: { value: 'cloze' } });
    expect(mockTrack).toHaveBeenCalledWith('card_style_selected', {
      style: 'cloze',
    });
  });
});
