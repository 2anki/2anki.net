import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CookiesProvider } from 'react-cookie';
import LoginForm from './index';

const mockLogin = vi.fn();
const mockRequestMagicLink = vi.fn();

vi.mock('../../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    login: mockLogin,
    requestMagicLink: mockRequestMagicLink,
  }),
}));

function renderLoginForm(entry = '/login') {
  return render(
    <CookiesProvider>
      <MemoryRouter initialEntries={[entry]}>
        <LoginForm />
      </MemoryRouter>
    </CookiesProvider>
  );
}

describe('LoginForm', () => {
  beforeEach(() => {
    localStorage.clear();
    mockLogin.mockReset();
    mockLogin.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ token: 'test-token' }),
    });
    mockRequestMagicLink.mockReset();
    mockRequestMagicLink.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ message: 'ok' }),
    });
  });

  it('renders email step with email input and primary CTA', () => {
    renderLoginForm();
    expect(
      screen.getByRole('heading', { name: 'Log in to 2anki' })
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Email me a sign-in link' })
    ).toBeInTheDocument();
  });

  it('shows the product subtitle on the email step', () => {
    renderLoginForm();
    expect(
      screen.getByText('Turn your notes into Anki cards.')
    ).toBeInTheDocument();
  });

  it('shows the magic-link helper text under the email input', () => {
    renderLoginForm();
    expect(
      screen.getByText("We'll email you a sign-in link — no password needed.")
    ).toBeInTheDocument();
  });

  it('primary CTA is disabled when email is empty', () => {
    renderLoginForm();
    expect(
      screen.getByRole('button', { name: 'Email me a sign-in link' })
    ).toBeDisabled();
  });

  it('primary CTA is enabled when email is filled in', () => {
    renderLoginForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'test@example.com' },
    });
    expect(
      screen.getByRole('button', { name: 'Email me a sign-in link' })
    ).not.toBeDisabled();
  });

  it('does not show password field on email step', () => {
    renderLoginForm();
    expect(screen.queryByPlaceholderText('Password')).toBeNull();
  });

  it('shows Google OAuth card on email step', () => {
    renderLoginForm();
    expect(
      screen.getByRole('link', { name: 'Sign in with Google' })
    ).toBeInTheDocument();
  });

  it('shows Microsoft OAuth card on email step', () => {
    renderLoginForm();
    expect(
      screen.getByRole('link', { name: 'Sign in with Microsoft' })
    ).toBeInTheDocument();
  });

  it('shows Notion OAuth card on email step', () => {
    renderLoginForm();
    expect(
      screen.getByRole('link', { name: 'Continue with Notion' })
    ).toBeInTheDocument();
  });

  it('shows Use password instead link on email step', () => {
    renderLoginForm();
    expect(screen.getByText('Use password instead')).toBeInTheDocument();
  });

  it('transitions to password step after clicking Use password instead', () => {
    renderLoginForm();
    fireEvent.click(screen.getByText('Use password instead'));

    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('shows change link and forgot password on password step', () => {
    renderLoginForm();
    fireEvent.click(screen.getByText('Use password instead'));

    expect(screen.getByText('Change')).toBeInTheDocument();
    expect(screen.getByText('Forgot your password?')).toBeInTheDocument();
  });

  it('returns to email step when change is clicked', () => {
    renderLoginForm();
    fireEvent.click(screen.getByText('Use password instead'));

    fireEvent.click(screen.getByText('Change'));
    expect(
      screen.getByRole('button', { name: 'Email me a sign-in link' })
    ).toBeInTheDocument();
  });

  it('shows magic link option on password step', () => {
    renderLoginForm();
    fireEvent.click(screen.getByText('Use password instead'));

    expect(screen.getByText('Send a login link instead')).toBeInTheDocument();
  });

  it('transitions to check-email step after clicking primary CTA', async () => {
    renderLoginForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Email me a sign-in link' })
    );

    await waitFor(() => {
      expect(screen.getByText('Check your email')).toBeInTheDocument();
    });
  });

  it('forwards a safe redirect from the URL to the magic-link request', async () => {
    renderLoginForm('/login?redirect=/upload');
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Email me a sign-in link' })
    );

    await waitFor(() => {
      expect(mockRequestMagicLink).toHaveBeenCalledWith(
        'test@example.com',
        'login',
        '/upload'
      );
    });
  });

  it('drops an unsafe redirect from the URL before requesting the link', async () => {
    renderLoginForm('/login?redirect=https://evil.example');
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Email me a sign-in link' })
    );

    await waitFor(() => {
      expect(mockRequestMagicLink).toHaveBeenCalledWith(
        'test@example.com',
        'login',
        undefined
      );
    });
  });

  it('transitions to check-email step via magic link on password step', async () => {
    renderLoginForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByText('Use password instead'));
    fireEvent.click(screen.getByText('Send a login link instead'));

    await waitFor(() => {
      expect(screen.getByText('Check your email')).toBeInTheDocument();
    });
  });

  it('shows a recovery message instead of check-email when the address is suppressed', async () => {
    mockRequestMagicLink.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ message: 'suppressed', suppressed: true }),
    });
    renderLoginForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'blocked@example.com' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Email me a sign-in link' })
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      "We can't email this address — it bounced or was unsubscribed earlier. Contact support@2anki.net to restore it, or use your password below."
    );
    expect(screen.queryByText('Check your email')).toBeNull();
  });

  it('shows create account button on the email step', () => {
    renderLoginForm();
    expect(screen.getByText("Sign up — it's free")).toBeInTheDocument();
    expect(
      screen.getByText("Sign up — it's free").closest('a')
    ).toHaveAttribute('href', '/register');
  });

  it('shows forgot password link on the email step', () => {
    renderLoginForm();
    const link = screen.getByRole('link', { name: 'Forgot your password?' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/forgot');
  });

  it('shows dont have an account copy on email step', () => {
    renderLoginForm();
    expect(screen.getByText("Don't have an account?")).toBeInTheDocument();
  });

  it('persists email to localStorage on blur when value looks like an email', () => {
    renderLoginForm();
    const input = screen.getByRole('textbox', { name: 'Email' });
    fireEvent.change(input, { target: { value: 'stored@example.com' } });
    fireEvent.blur(input);
    expect(localStorage.getItem('email')).toBe('stored@example.com');
  });

  it('does not persist to localStorage on blur when value has no @', () => {
    renderLoginForm();
    const input = screen.getByRole('textbox', { name: 'Email' });
    fireEvent.change(input, { target: { value: 'notanemail' } });
    fireEvent.blur(input);
    expect(localStorage.getItem('email')).toBeNull();
  });

  it('restores email from localStorage', () => {
    localStorage.setItem('email', 'saved@example.com');
    renderLoginForm();
    const emailInput = screen.getByRole('textbox', {
      name: 'Email',
    }) as HTMLInputElement;
    expect(emailInput.value).toBe('saved@example.com');
  });

  it('announces a failed login via role=alert wired to the submit button', async () => {
    mockLogin.mockResolvedValue({
      status: 401,
      json: () => Promise.resolve({}),
    });
    renderLoginForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByText('Use password instead'));
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Wrong email or password. Try again or reset your password.'
    );
    expect(alert).toHaveAttribute('id', 'login-error');
    expect(screen.getByRole('button', { name: 'Log in' })).toHaveAttribute(
      'aria-describedby',
      'login-error'
    );
  });
});
