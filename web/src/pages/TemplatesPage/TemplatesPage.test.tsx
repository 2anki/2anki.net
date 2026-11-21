import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TemplatesPage from './TemplatesPage';
import i18n from '../../lib/i18n';
import * as templatesApi from '../../lib/backend/templates';
import { NoteTypeStarter } from '../../lib/backend/templates';

const sampleStarter: NoteTypeStarter = {
  id: 'basic-clean',
  name: 'Clean Basic',
  description: 'A minimal, clean basic note type',
  baseType: 'basic',
  noteType: {
    id: 1,
    name: 'Basic',
    type: 0,
    tmpls: [
      {
        name: 'Card 1',
        ord: 0,
        qfmt: '{{Front}}',
        afmt: '{{FrontSide}}<hr>{{Back}}',
      },
    ],
    flds: [
      { name: 'Front', ord: 0 },
      { name: 'Back', ord: 1 },
    ],
    css: '.card { color: black; }',
  },
  previewData: { Front: 'Capital of France?', Back: 'Paris' },
  tags: ['basic'],
};

const clozeStarter: NoteTypeStarter = {
  id: 'cloze-modern',
  name: 'Modern Cloze',
  description: 'A cloze deletion template',
  baseType: 'cloze',
  noteType: {
    id: 2,
    name: 'Cloze',
    type: 1,
    tmpls: [
      {
        name: 'Cloze',
        ord: 0,
        qfmt: '{{cloze:Text}}',
        afmt: '{{cloze:Text}}<br>{{Extra}}',
      },
    ],
    flds: [
      { name: 'Text', ord: 0 },
      { name: 'Extra', ord: 1 },
    ],
    css: '',
  },
  previewData: {
    Text: 'Capital of {{c1::France}} is {{c2::Paris}}',
    Extra: 'European geography',
  },
  tags: ['cloze'],
};

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <TemplatesPage />
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('TemplatesPage', () => {
  let getDefaults: ReturnType<typeof vi.spyOn>;
  let download: ReturnType<typeof vi.spyOn>;
  const createObjectURL = vi.fn<(obj: Blob | MediaSource) => string>(
    () => 'blob:fake'
  );
  const revokeObjectURL = vi.fn<(url: string) => void>();
  const clickSpy = vi.fn<() => void>();

  beforeEach(() => {
    getDefaults = vi.spyOn(templatesApi, 'getDefaultNoteTypes');
    download = vi.spyOn(templatesApi, 'downloadNoteTypeApkg');
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    clickSpy.mockClear();
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;
    HTMLAnchorElement.prototype.click = clickSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the page title and subtitle', async () => {
    getDefaults.mockResolvedValue([sampleStarter]);
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: /note types/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/starter anki note types/i)).toBeInTheDocument();
  });

  it('marks the English starter name and description from the server as English', async () => {
    getDefaults.mockResolvedValue([sampleStarter]);
    await i18n.changeLanguage('ja');
    try {
      renderPage();

      const name = await screen.findByRole('button', { name: 'Clean Basic' });
      expect(name.closest('[lang]')).toHaveAttribute('lang', 'en');
      expect(
        screen.getByText(sampleStarter.description).closest('[lang]')
      ).toHaveAttribute('lang', 'en');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('lists every starter returned by the API', async () => {
    getDefaults.mockResolvedValue([sampleStarter, clozeStarter]);
    renderPage();

    expect(
      await screen.findByRole('button', { name: 'Clean Basic' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Modern Cloze' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('A minimal, clean basic note type')
    ).toBeInTheDocument();
  });

  it('shows a load error when the API fails', async () => {
    getDefaults.mockRejectedValue(new Error('network down'));
    renderPage();

    expect(
      await screen.findByText(/could not load note types/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/network down/i)).toBeInTheDocument();
  });

  it('shows an empty state when no starters are returned', async () => {
    getDefaults.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/no note types yet/i)).toBeInTheDocument();
  });

  it('downloads the .apkg when the Download button is clicked', async () => {
    getDefaults.mockResolvedValue([sampleStarter]);
    download.mockResolvedValue(
      new Blob(['apkg'], { type: 'application/octet-stream' })
    );

    renderPage();

    const button = await screen.findByRole('button', {
      name: /download.*\.apkg/i,
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(download).toHaveBeenCalledWith(
        sampleStarter.noteType,
        sampleStarter.previewData
      );
    });
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('shows a download error if the API fails to build the apkg', async () => {
    getDefaults.mockResolvedValue([sampleStarter]);
    download.mockRejectedValue(new Error('wasm missing'));

    renderPage();

    const button = await screen.findByRole('button', {
      name: /download.*\.apkg/i,
    });
    fireEvent.click(button);

    expect(await screen.findByText(/wasm missing/i)).toBeInTheDocument();
  });

  it('opens a preview dialog when the name is clicked', async () => {
    getDefaults.mockResolvedValue([sampleStarter]);
    renderPage();

    const name = await screen.findByRole('button', { name: 'Clean Basic' });
    fireEvent.click(name);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute(
      'aria-labelledby',
      'note-type-preview-title'
    );
    expect(screen.getByText('Front')).toBeInTheDocument();
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('renders the modal preview iframes with the field content in srcDoc', async () => {
    getDefaults.mockResolvedValue([sampleStarter]);
    renderPage();

    const name = await screen.findByRole('button', { name: 'Clean Basic' });
    fireEvent.click(name);
    await screen.findByRole('dialog');

    const frontFrame = screen.getByTitle(
      'Clean Basic front preview'
    ) as HTMLIFrameElement;
    const backFrame = screen.getByTitle(
      'Clean Basic back preview'
    ) as HTMLIFrameElement;
    expect(frontFrame.srcdoc).toContain('Capital of France?');
    expect(backFrame.srcdoc).toContain('Paris');
  });

  it('opens a preview dialog when the Preview button is clicked', async () => {
    getDefaults.mockResolvedValue([sampleStarter]);
    renderPage();

    const previewButton = await screen.findByRole('button', {
      name: /preview clean basic/i,
    });
    fireEvent.click(previewButton);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute(
      'aria-labelledby',
      'note-type-preview-title'
    );
    expect(screen.getByText('Front')).toBeInTheDocument();
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('closes the preview when Escape is pressed', async () => {
    getDefaults.mockResolvedValue([sampleStarter]);
    renderPage();

    const name = await screen.findByRole('button', { name: 'Clean Basic' });
    fireEvent.click(name);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
