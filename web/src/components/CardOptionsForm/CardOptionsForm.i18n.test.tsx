import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import i18n from '../../lib/i18n';
import deCardOptions from '../../lib/i18n/locales/de/cardoptions.json';
import CardOption from '../../lib/data_layer/model/CardOption';
import { CardOptionsForm } from './CardOptionsForm';

const mockGetSettingsCardOptions = vi.fn();
const mockUseUserLocals = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    resetUserCardOptions: vi.fn().mockResolvedValue(undefined),
    deleteSettings: vi.fn().mockResolvedValue(undefined),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue(null),
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

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CardOptionsForm pageId={null} isLoggedIn setError={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CardOptionsForm in German', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetSettingsCardOptions.mockResolvedValue([]);
    mockUseUserLocals.mockReturnValue({
      data: { locals: { patreon: false, subscriber: false } },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    localStorage.clear();
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates section headings and the deck name field', async () => {
    renderForm();
    expect(await screen.findByText('Stapel & Struktur')).toBeInTheDocument();
    expect(screen.getByText('Stapelname')).toBeInTheDocument();
    expect(screen.getByText('Vorlagen')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Stapelnamen eingeben (optional)')
    ).toBeInTheDocument();
  });

  it('shows the translated label and description for an option key with a translation', async () => {
    i18n.addResourceBundle(
      'de',
      'cardoptions',
      {
        options: {
          'wiring-check-option': {
            label: 'Übersetztes Etikett',
            description: 'Übersetzte Beschreibung',
          },
        },
      },
      true,
      true
    );
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOption(
        'wiring-check-option',
        'Server English label',
        'Server English description'
      ),
    ]);
    renderForm();

    expect(await screen.findByText('Übersetztes Etikett')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Übersetzte Beschreibung' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Server English label')).not.toBeInTheDocument();
  });

  it('renders the shipped German text for a real option instead of the English server text', async () => {
    const english = {
      label: 'Add Notion link',
      description: 'Add a link back to the Notion page on each card.',
    };
    const german = deCardOptions.options['add-notion-link'];
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOption('add-notion-link', english.label, english.description),
    ]);
    renderForm();

    expect(await screen.findByText(german.label)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: german.description })
    ).toBeInTheDocument();
    expect(german.label).not.toBe(english.label);
    expect(screen.queryByText(english.label)).not.toBeInTheDocument();
  });

  it('falls back to the server text for an option key with no translation', async () => {
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOption(
        'untranslated-option',
        'Server English label',
        'Server English description'
      ),
    ]);
    renderForm();

    expect(await screen.findByText('Server English label')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Server English description' })
    ).toBeInTheDocument();
  });

  it('translates the section tags row that sits outside the checkbox list', async () => {
    i18n.addResourceBundle(
      'de',
      'cardoptions',
      {
        options: {
          cherry: {
            label: 'Kirsche Test',
            description: 'Kirsche Beschreibung',
          },
          'section-tags': {
            label: 'Abschnitts-Tags Test',
            description: 'Abschnitts-Tags Beschreibung',
          },
        },
      },
      true,
      true
    );
    mockGetSettingsCardOptions.mockResolvedValue([
      new CardOption('cherry', 'Cherry-pick', 'Cherry description'),
      new CardOption(
        'section-tags',
        'Section tags',
        'Section tags description'
      ),
    ]);
    renderForm();

    expect(
      (await screen.findAllByText('Abschnitts-Tags Test')).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Section tags')).not.toBeInTheDocument();
  });
});
