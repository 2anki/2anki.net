import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CookiesProvider } from 'react-cookie';
import i18n from '../../lib/i18n';
import MagicLinkPage from './MagicLinkPage';

const mockValidateMagicToken = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    validateMagicToken: mockValidateMagicToken,
    confirmMagicLink: vi.fn(),
    requestMagicLink: vi.fn(),
  }),
}));

describe('MagicLinkPage in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the expired-link chrome in German', () => {
    render(
      <CookiesProvider>
        <MemoryRouter initialEntries={['/auth/magic']}>
          <MagicLinkPage />
        </MemoryRouter>
      </CookiesProvider>
    );

    expect(
      screen.getByRole('heading', { name: 'Link abgelaufen oder ungültig' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Dieser Link wurde schon verwendet oder ist abgelaufen. Lass dir unten einen neuen schicken.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('E-Mail')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('E-Mail-Adresse')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Neuen Link senden' })
    ).toBeInTheDocument();
  });

  it('asks in German before signing in from another browser', async () => {
    mockValidateMagicToken.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          confirm: true,
          purpose: 'login',
          email: 'l•••@example.com',
        }),
    });
    render(
      <CookiesProvider>
        <MemoryRouter initialEntries={['/auth/magic?token=abc123']}>
          <MagicLinkPage />
        </MemoryRouter>
      </CookiesProvider>
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Als l•••@example.com bei 2anki anmelden?',
      })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anmelden' })).toBeEnabled();
  });
});
