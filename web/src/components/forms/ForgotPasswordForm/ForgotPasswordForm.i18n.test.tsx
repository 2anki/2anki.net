import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../lib/i18n';
import { UserNotice } from '../../../lib/errors/UserNotice';
import ForgotPasswordForm from './ForgotPasswordForm';

const mockRequestMagicLink = vi.fn();

vi.mock('../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({ requestMagicLink: mockRequestMagicLink }),
}));

describe('ForgotPasswordForm in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the reset heading and CTA in German', () => {
    render(<ForgotPasswordForm setError={vi.fn()} />);
    expect(
      screen.getByRole('heading', { name: 'Passwort zurücksetzen' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Link zum Zurücksetzen senden' })
    ).toBeInTheDocument();
  });

  it('reports the failed send in German', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: false, status: 500 });
    const setError = vi.fn();
    render(<ForgotPasswordForm setError={setError} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'reader@example.com' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Link zum Zurücksetzen senden' })
    );

    await waitFor(() => expect(setError).toHaveBeenCalledTimes(1));
    const [notice] = setError.mock.calls[0];
    expect(notice).toBeInstanceOf(UserNotice);
    expect(notice.message).toBe(
      'Der Link konnte gerade nicht gesendet werden. Versuch es gleich noch einmal.'
    );
  });
});
