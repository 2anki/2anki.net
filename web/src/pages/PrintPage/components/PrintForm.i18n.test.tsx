import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import i18n from '../../../lib/i18n';
import PrintForm from './PrintForm';

vi.mock('../../../lib/hooks/useUserLocals', () => ({
  useUserLocals: () => ({
    data: {
      locals: { patreon: false, subscriber: false },
      freePrintAvailable: true,
    },
  }),
}));

describe('PrintForm in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
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
});
