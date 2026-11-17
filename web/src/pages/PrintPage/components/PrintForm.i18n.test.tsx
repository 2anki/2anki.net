import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import i18n from '../../../lib/i18n';
import PrintForm from './PrintForm';

vi.mock('../../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({
    data: {
      user: { id: 7 },
      locals: { patreon: false, subscriber: false },
      freePrintAvailable: true,
    },
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../lib/analytics/track', () => ({ track: vi.fn() }));

describe('PrintForm in German', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await i18n.changeLanguage('en');
  });

  it('translates the option labels and the drop zone', () => {
    render(
      <MemoryRouter>
        <PrintForm />
      </MemoryRouter>
    );
    expect(screen.getByText('Papierformat')).toBeInTheDocument();
    expect(screen.getByText('Ausrichtung')).toBeInTheDocument();
    expect(
      screen.getByText('Zieh einen Anki-Stapel (.apkg) hierher')
    ).toBeInTheDocument();
    expect(screen.getByText('Datei auswählen')).toBeInTheDocument();
  });

  it('shows the translated error, not the server English, for a preview the server refused', async () => {
    const body = {
      message: 'This deck took too long to render. Try a smaller deck.',
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => body,
      clone: () => ({ json: async () => body }),
    });
    render(
      <MemoryRouter>
        <PrintForm />
      </MemoryRouter>
    );

    const input = screen.getByLabelText(/Anki-Stapel/i, {
      selector: 'input[type="file"]',
    });
    fireEvent.change(input, {
      target: { files: [new File(['fake'], 'deck.apkg')] },
    });

    expect(
      await screen.findByText(
        'Beim Erstellen des PDFs ist etwas schiefgelaufen. Versuch es erneut.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'This deck took too long to render. Try a smaller deck.'
      )
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Erneut versuchen' })
    ).toBeInTheDocument();
  });
});
