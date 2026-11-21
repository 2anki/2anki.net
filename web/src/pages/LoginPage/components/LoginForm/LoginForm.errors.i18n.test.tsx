import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CookiesProvider } from 'react-cookie';
import i18n from '../../../../lib/i18n';
import LoginForm from './index';

const mockLogin = vi.fn();

vi.mock('../../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    login: mockLogin,
    requestMagicLink: vi.fn(),
  }),
}));

const WRONG_CREDENTIALS = {
  en: 'Wrong email or password. Try again or reset your password.',
  de: 'Falsche E-Mail oder falsches Passwort. Versuch es erneut oder setz dein Passwort zurück.',
  ja: 'メールアドレスまたはパスワードが正しくありません。もう一度お試しいただくか、パスワードをリセットしてください。',
};

const GOOGLE_HINT = {
  en: 'This account uses Google sign-in — use "Sign in with Google" or send a login link.',
  de: 'Dieses Konto nutzt die Anmeldung mit Google — verwende „Sign in with Google“ oder lass dir einen Anmeldelink senden.',
  ja: 'このアカウントは Google でのサインインを使用しています — 「Sign in with Google」をご利用いただくか、ログインリンクを送信してください。',
};

type Lang = keyof typeof WRONG_CREDENTIALS;

function renderLoginForm() {
  return render(
    <CookiesProvider>
      <MemoryRouter initialEntries={['/login']}>
        <LoginForm />
      </MemoryRouter>
    </CookiesProvider>
  );
}

async function submitPassword(): Promise<HTMLElement> {
  const { container } = renderLoginForm();
  const email = container.querySelector('#email') as HTMLInputElement;
  fireEvent.change(email, { target: { value: 'test@example.com' } });
  fireEvent.click(container.querySelector('a[href="#password"]') as Element);
  const password = container.querySelector('#password') as HTMLInputElement;
  fireEvent.change(password, { target: { value: 'wrongpassword' } });
  fireEvent.click(container.querySelector('button[type="submit"]') as Element);
  return screen.findByRole('alert');
}

describe.each<Lang>(['en', 'de', 'ja'])(
  'LoginForm password errors in %s',
  (lang) => {
    beforeEach(async () => {
      localStorage.clear();
      mockLogin.mockReset();
      await i18n.changeLanguage(lang);
    });

    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('shows the wrong-credentials message on a 401', async () => {
      mockLogin.mockResolvedValue({
        status: 401,
        json: () => Promise.resolve({ message: 'Wrong email or password.' }),
      });
      const alert = await submitPassword();
      expect(alert.textContent).toBe(WRONG_CREDENTIALS[lang]);
    });

    it('adds the Google sign-in hint when the server sends hint google', async () => {
      mockLogin.mockResolvedValue({
        status: 401,
        json: () =>
          Promise.resolve({
            message: 'Wrong email or password.',
            hint: 'google',
          }),
      });
      const alert = await submitPassword();
      expect(alert.textContent).toBe(
        `${WRONG_CREDENTIALS[lang]} ${GOOGLE_HINT[lang]}`
      );
    });

    it('shows the wrong-credentials message on any other failed status', async () => {
      mockLogin.mockResolvedValue({
        status: 400,
        json: () => Promise.resolve({ message: 'Invalid user data.' }),
      });
      const alert = await submitPassword();
      expect(alert.textContent).toBe(WRONG_CREDENTIALS[lang]);
    });
  }
);
