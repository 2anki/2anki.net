import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EditorPage from './EditorPage';
import * as templatesApi from '../../lib/backend/templates';
import { NoteTypeStarter } from '../../lib/backend/templates';

let mockPayingLocals = { patreon: false, subscriber: true };

vi.mock('../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({
    data: { locals: { owner: 1, ...mockPayingLocals } },
    refetch: vi.fn(),
  }),
}));

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

vi.mock('./components/CodeEditor/CodeEditor', () => ({
  CodeEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (next: string) => void;
    ariaLabel: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  default: () => null,
}));

const sampleStarter: NoteTypeStarter = {
  id: 'basic-clean',
  name: 'Clean Basic',
  description: 'A minimal note type',
  baseType: 'basic',
  noteType: {
    id: 1,
    name: 'Clean Basic',
    type: 0,
    tmpls: [{ name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{Back}}' }],
    flds: [
      { name: 'Front', ord: 0 },
      { name: 'Back', ord: 1 },
    ],
    css: '.card { color: black; }',
  },
  previewData: { Front: 'Q', Back: 'A' },
  tags: [],
};

function renderEditor(mode: 'new' | 'edit', initialEntry: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/templates/new" element={<EditorPage mode={mode} />} />
          <Route
            path="/templates/edit/:id"
            element={<EditorPage mode={mode} />}
          />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('EditorPage (new)', () => {
  beforeEach(() => {
    vi.spyOn(templatesApi, 'saveUserTemplate').mockResolvedValue({
      templates: [],
      hiddenIds: [],
    });
    vi.spyOn(templatesApi, 'getDefaultNoteTypes').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the preset picker first', async () => {
    renderEditor('new', '/templates/new');
    expect(
      await screen.findByRole('button', { name: /blank basic/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /blank cloze/i })
    ).toBeInTheDocument();
  });

  it('opens the editor with My Basic when Blank Basic is picked', async () => {
    renderEditor('new', '/templates/new');
    fireEvent.click(
      await screen.findByRole('button', { name: /blank basic/i })
    );
    expect(
      await screen.findByRole('textbox', { name: /template name/i })
    ).toHaveValue('My Basic');
  });

  it('opens the editor with My Cloze when Blank Cloze is picked', async () => {
    renderEditor('new', '/templates/new');
    fireEvent.click(
      await screen.findByRole('button', { name: /blank cloze/i })
    );
    expect(
      await screen.findByRole('textbox', { name: /template name/i })
    ).toHaveValue('My Cloze');
  });

  it('renders the three editor tabs after picking a preset', async () => {
    renderEditor('new', '/templates/new');
    fireEvent.click(
      await screen.findByRole('button', { name: /blank basic/i })
    );
    await screen.findByRole('textbox', { name: /template name/i });
    expect(screen.getByRole('tab', { name: 'Front' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Styling' })).toBeInTheDocument();
  });

  it('saves a new template via saveUserTemplate', async () => {
    const save = vi
      .spyOn(templatesApi, 'saveUserTemplate')
      .mockResolvedValue({ templates: [], hiddenIds: [] });
    renderEditor('new', '/templates/new');
    fireEvent.click(
      await screen.findByRole('button', { name: /blank basic/i })
    );

    await screen.findByRole('textbox', { name: /template name/i });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(save.mock.calls[0][0].name).toBe('My Basic');
  });
});

describe('EditorPage (edit)', () => {
  beforeEach(() => {
    vi.spyOn(templatesApi, 'getDefaultNoteTypes').mockResolvedValue([
      sampleStarter,
    ]);
    vi.spyOn(templatesApi, 'getOfficialNoteTypes').mockResolvedValue([]);
    vi.spyOn(templatesApi, 'getUserTemplates').mockResolvedValue({
      templates: [],
      hiddenIds: [],
    });
    vi.spyOn(templatesApi, 'saveUserTemplate').mockResolvedValue({
      templates: [],
      hiddenIds: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads an existing starter and shows its name', async () => {
    renderEditor('edit', `/templates/edit/${sampleStarter.id}`);
    expect(await screen.findByDisplayValue('Clean Basic')).toBeInTheDocument();
  });

  it('shows "Save as copy" when editing a default (not owned)', async () => {
    renderEditor('edit', `/templates/edit/${sampleStarter.id}`);
    expect(
      await screen.findByRole('button', { name: /save as copy/i })
    ).toBeInTheDocument();
  });

  it('shows "Save" when editing a user-owned template', async () => {
    vi.spyOn(templatesApi, 'getUserTemplates').mockResolvedValue({
      templates: [sampleStarter],
      hiddenIds: [],
    });
    renderEditor('edit', `/templates/edit/${sampleStarter.id}`);
    expect(
      await screen.findByRole('button', { name: /^save$/i })
    ).toBeInTheDocument();
  });

  it('shows a not-found message when the id is missing', async () => {
    vi.spyOn(templatesApi, 'getDefaultNoteTypes').mockResolvedValue([]);
    renderEditor('edit', '/templates/edit/missing-id');
    expect(await screen.findByText(/template not found/i)).toBeInTheDocument();
  });

  it('loads a starter that lives only in the official set', async () => {
    const officialStarter: NoteTypeStarter = {
      ...sampleStarter,
      id: 'official-only-notion-basic',
      name: 'Only Notion (Basic)',
    };
    vi.spyOn(templatesApi, 'getDefaultNoteTypes').mockResolvedValue([]);
    vi.spyOn(templatesApi, 'getOfficialNoteTypes').mockResolvedValue([
      officialStarter,
    ]);
    renderEditor('edit', `/templates/edit/${officialStarter.id}`);
    expect(
      await screen.findByDisplayValue('Only Notion (Basic)')
    ).toBeInTheDocument();
  });
});

describe('EditorPage chat (modify path)', () => {
  beforeEach(() => {
    vi.spyOn(templatesApi, 'getDefaultNoteTypes').mockResolvedValue([
      sampleStarter,
    ]);
    vi.spyOn(templatesApi, 'getOfficialNoteTypes').mockResolvedValue([]);
    vi.spyOn(templatesApi, 'getUserTemplates').mockResolvedValue({
      templates: [sampleStarter],
      hiddenIds: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openChatReady() {
    renderEditor('edit', `/templates/edit/${sampleStarter.id}`);
    await screen.findByDisplayValue('Clean Basic');
    return screen.getByRole('textbox', {
      name: /ask claude/i,
    }) as HTMLInputElement;
  }

  it('shows "Nothing changed" when Claude returns the same starter', async () => {
    vi.spyOn(templatesApi, 'aiModifyNoteType').mockResolvedValue({
      reply: 'Switched to a clean, minimal design with blue accents.',
      starter: sampleStarter,
    });

    const input = await openChatReady();
    fireEvent.change(input, { target: { value: 'make it look anking style' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(
      await screen.findByText(/nothing changed\. try a more specific/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/switched to a clean, minimal design/i)
    ).not.toBeInTheDocument();
  });

  it("uses Claude's reply when the starter actually changed", async () => {
    const modified: NoteTypeStarter = {
      ...sampleStarter,
      noteType: {
        ...sampleStarter.noteType,
        css: '.card { color: midnightblue; }',
      },
    };
    vi.spyOn(templatesApi, 'aiModifyNoteType').mockResolvedValue({
      reply: 'Switched the body colour to midnight blue.',
      starter: modified,
    });

    const input = await openChatReady();
    fireEvent.change(input, { target: { value: 'use midnight blue' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(
      await screen.findByText(/switched the body colour to midnight blue/i)
    ).toBeInTheDocument();
  });

  it('shows a Try again button on error and retries with the same instruction', async () => {
    const modifySpy = vi
      .spyOn(templatesApi, 'aiModifyNoteType')
      .mockRejectedValueOnce(
        new Error('The AI is briefly unavailable — try again in a moment.')
      )
      .mockResolvedValueOnce({
        reply: 'Added a Hint field.',
        starter: {
          ...sampleStarter,
          noteType: {
            ...sampleStarter.noteType,
            flds: [...sampleStarter.noteType.flds, { name: 'Hint', ord: 2 }],
          },
        },
      });

    const input = await openChatReady();
    fireEvent.change(input, { target: { value: 'add a hint field' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    const retry = await screen.findByRole('button', { name: /try again/i });
    expect(retry).toBeInTheDocument();

    fireEvent.click(retry);

    expect(await screen.findByText(/added a hint field/i)).toBeInTheDocument();
    expect(modifySpy).toHaveBeenCalledTimes(2);
    expect(modifySpy.mock.calls[0][1]).toBe('add a hint field');
    expect(modifySpy.mock.calls[1][1]).toBe('add a hint field');
  });

  it('replaces the Ask Claude rail with the upgrade panel for a free user', async () => {
    mockPayingLocals = { patreon: false, subscriber: false };
    try {
      renderEditor('edit', `/templates/edit/${sampleStarter.id}`);
      await screen.findByDisplayValue('Clean Basic');
      expect(
        screen.getByTestId('note-type-ai-upgrade-panel')
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /see plans/i })).toHaveAttribute(
        'href',
        '/pricing?source=note-type-ai-paywall'
      );
      expect(
        screen.queryByPlaceholderText(/ask claude to change something/i)
      ).not.toBeInTheDocument();
    } finally {
      mockPayingLocals = { patreon: false, subscriber: true };
    }
  });
});
