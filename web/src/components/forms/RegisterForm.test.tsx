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
import RegisterForm from './RegisterForm';
import { UserNotice } from '../../lib/errors/UserNotice';

const registerMock = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    register: registerMock,
  }),
}));

const trackMock = vi.fn();
vi.mock('../../lib/analytics/track', () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

function fillAndSubmit() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
    target: { value: 'taken@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'supersecret' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

function renderForm(redirect?: string, setErrorMessage = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/register']}>
      <RegisterForm
        setErrorMessage={setErrorMessage}
        redirect={redirect ?? null}
      />
    </MemoryRouter>
  );
  return setErrorMessage;
}

describe('RegisterForm', () => {
  beforeEach(() => {
    registerMock.mockReset();
    trackMock.mockClear();
    localStorage.clear();
    globalThis.sessionStorage.clear();
  });

  it('tracks signup_completed once with method email on a successful registration', async () => {
    registerMock.mockResolvedValue({ status: 200 });

    renderForm();
    fillAndSubmit();

    await waitFor(() => {
      expect(trackMock).toHaveBeenCalledWith('signup_completed', {
        method: 'email',
      });
    });
    expect(
      trackMock.mock.calls.filter(([name]) => name === 'signup_completed')
    ).toHaveLength(1);
  });

  describe('post-signup destination', () => {
    let hrefValue: string;

    beforeEach(() => {
      hrefValue = 'http://localhost/register';
      vi.stubGlobal('location', {
        origin: 'http://localhost',
        search: '',
        get href() {
          return hrefValue;
        },
        set href(value: string) {
          hrefValue = value;
        },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('lands a new signup with no redirect on the upload page', async () => {
      registerMock.mockResolvedValue({ status: 200 });

      renderForm();
      fillAndSubmit();

      await waitFor(() => expect(hrefValue).toBe('/upload'));
    });

    it('honors an explicit redirect over the upload default', async () => {
      registerMock.mockResolvedValue({ status: 200 });

      renderForm('/pricing');
      fillAndSubmit();

      await waitFor(() => expect(hrefValue).toBe('/pricing'));
    });
  });

  it('fires signup_started once with method email on mount', () => {
    registerMock.mockResolvedValue({ status: 200 });

    renderForm();

    expect(
      trackMock.mock.calls.filter(([name]) => name === 'signup_started')
    ).toEqual([['signup_started', { method: 'email' }]]);
  });

  it.each([
    ['Google', 'google'],
    ['Notion', 'notion'],
    ['Microsoft', 'microsoft'],
    ['Apple', 'apple'],
  ])(
    'fires signup_started once with method %s when the OAuth button is clicked',
    (label, method) => {
      renderForm();
      trackMock.mockClear();

      const link = screen.getByText(label).closest('a');
      expect(link).not.toBeNull();
      fireEvent.click(link as HTMLElement);

      expect(
        trackMock.mock.calls.filter(([name]) => name === 'signup_started')
      ).toEqual([['signup_started', { method }]]);
    }
  );

  it('fires signup_failed with method email on a non-200 response', async () => {
    registerMock.mockResolvedValue({
      status: 400,
      json: () =>
        Promise.resolve({
          message: 'Invalid user data. Required email and password!',
        }),
    });

    renderForm();
    fillAndSubmit();

    await waitFor(() => {
      expect(trackMock).toHaveBeenCalledWith('signup_failed', {
        method: 'email',
      });
    });
  });

  it('does not fire signup_failed on a successful registration', async () => {
    registerMock.mockResolvedValue({ status: 200 });

    renderForm();
    fillAndSubmit();

    await waitFor(() => {
      expect(trackMock).toHaveBeenCalledWith('signup_completed', {
        method: 'email',
      });
    });
    expect(trackMock).not.toHaveBeenCalledWith('signup_failed', {
      method: 'email',
    });
  });

  it('sets the signup dedup flag so the upload page does not re-fire', async () => {
    registerMock.mockResolvedValue({ status: 200 });

    renderForm();
    fillAndSubmit();

    await waitFor(() => {
      expect(
        globalThis.sessionStorage.getItem('signup_completed_tracked')
      ).toBe('1');
    });
  });

  it('does not track signup_completed when the account already exists', async () => {
    registerMock.mockResolvedValue({
      status: 400,
      json: () =>
        Promise.resolve({
          message:
            'An account with this email already exists. Try logging in instead.',
        }),
    });

    renderForm();
    fillAndSubmit();

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalled();
    });
    expect(trackMock).not.toHaveBeenCalledWith('signup_completed', {
      method: 'email',
    });
  });

  it('shows a recovery CTA with log in and reset password links when the account already exists', async () => {
    registerMock.mockResolvedValue({
      status: 400,
      json: () =>
        Promise.resolve({
          message:
            'An account with this email already exists. Try logging in instead.',
        }),
    });

    renderForm('/pricing');
    fillAndSubmit();

    const recovery = await screen.findByRole('alert');
    const logIn = within(recovery).getByRole('link', { name: 'Log in' });
    expect(logIn).toHaveAttribute('href', '/login?redirect=%2Fpricing');

    const reset = within(recovery).getByRole('link', {
      name: 'Reset password',
    });
    expect(reset).toHaveAttribute('href', '/forgot');
  });

  it('does not show the recovery CTA on a generic failure', async () => {
    registerMock.mockResolvedValue({
      status: 400,
      json: () =>
        Promise.resolve({
          message: 'Invalid user data. Required email and password!',
        }),
    });

    renderForm();
    fillAndSubmit();

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Reset password' })
    ).not.toBeInTheDocument();
  });

  it('wraps an intentional backend notice in UserNotice so it shows without being reported', async () => {
    const notice = 'An account with this email is linked to Google sign-in.';
    registerMock.mockResolvedValue({
      status: 400,
      json: () => Promise.resolve({ message: notice }),
    });

    const setErrorMessage = renderForm();
    fillAndSubmit();

    await waitFor(() => {
      expect(setErrorMessage).toHaveBeenCalled();
    });
    const arg = setErrorMessage.mock.calls[0][0] as UserNotice;
    expect(arg).toBeInstanceOf(UserNotice);
    expect(arg.message).toBe(notice);
  });

  it('shows the generic error, not the account-exists message, when the request itself fails', async () => {
    registerMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const setErrorMessage = renderForm();
    fillAndSubmit();

    await waitFor(() => {
      expect(setErrorMessage).toHaveBeenCalledWith(
        'Something went wrong on our end. Try again, or email support@2anki.net if it keeps happening.'
      );
    });
  });

  it('passes a generic backend failure through as a plain message', async () => {
    registerMock.mockResolvedValue({
      status: 400,
      json: () =>
        Promise.resolve({
          message: 'Invalid user data. Required email and password!',
        }),
    });

    const setErrorMessage = renderForm();
    fillAndSubmit();

    await waitFor(() => {
      expect(setErrorMessage).toHaveBeenCalledWith(
        'Invalid user data. Required email and password!'
      );
    });
  });
});
