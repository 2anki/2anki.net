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

beforeEach(() => {
  localStorage.clear();
  mockRequestMagicLink.mockReset();
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('ForgotPasswordForm in German', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
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
});

describe('ForgotPasswordForm failed send in every locale', () => {
  it.each([
    ['en', "Couldn't send the link just now. Try again in a moment."],
    [
      'de',
      'Der Link konnte gerade nicht gesendet werden. Versuch es gleich noch einmal.',
    ],
    [
      'es',
      'No se pudo enviar el enlace ahora mismo. Inténtalo de nuevo en un momento.',
    ],
    [
      'fr',
      "Impossible d'envoyer le lien pour l'instant. Réessaie dans un moment.",
    ],
    [
      'it',
      'Non è stato possibile inviare il link in questo momento. Riprova tra un istante.',
    ],
    [
      'ja',
      '今はリンクを送信できませんでした。少し待ってからもう一度お試しください。',
    ],
    ['nl', 'Kon de link nu niet versturen. Probeer het zo meteen opnieuw.'],
    ['pl', 'Nie udało się teraz wysłać linku. Spróbuj ponownie za chwilę.'],
    [
      'pt',
      'Não foi possível enviar o link agora. Tente de novo em um instante.',
    ],
    [
      'ru',
      'Не удалось отправить ссылку сейчас. Попробуй ещё раз через минуту.',
    ],
  ])('reports the failed send in %s', async (language, expected) => {
    await i18n.changeLanguage(language);
    mockRequestMagicLink.mockResolvedValue({ ok: false, status: 500 });
    const setError = vi.fn();
    render(<ForgotPasswordForm setError={setError} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'reader@example.com' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('auth.forgot.sendResetLink') })
    );

    await waitFor(() => expect(setError).toHaveBeenCalledTimes(1));
    expect(mockRequestMagicLink).toHaveBeenCalledWith(
      'reader@example.com',
      'password_reset'
    );
    const [notice] = setError.mock.calls[0];
    expect(notice).toBeInstanceOf(UserNotice);
    expect(notice.message).toBe(expected);
  });
});
