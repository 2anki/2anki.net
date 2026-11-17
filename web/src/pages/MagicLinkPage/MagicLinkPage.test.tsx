import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { CookiesProvider } from 'react-cookie';
import MagicLinkPage from './MagicLinkPage';

const mockValidateMagicToken = vi.fn();
const mockConfirmMagicLink = vi.fn();
const mockRequestMagicLink = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    validateMagicToken: mockValidateMagicToken,
    confirmMagicLink: mockConfirmMagicLink,
    requestMagicLink: mockRequestMagicLink,
  }),
}));

const EXPIRED_COPY =
  'This link was already used or has expired. Send yourself a new one below.';

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const CONFIRM_LOGIN = {
  message: 'Open the link in your email again to finish signing in.',
  confirm: true,
  purpose: 'login',
  email: 'l•••@example.com',
};

const RETRY_COPY = "That didn't go through. Try again in a few minutes.";

function renderMagicLinkPage(queryString: string) {
  return render(
    <CookiesProvider>
      <MemoryRouter initialEntries={[`/auth/magic${queryString}`]}>
        <MagicLinkPage />
      </MemoryRouter>
    </CookiesProvider>
  );
}

describe('MagicLinkPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows error when no token is present', () => {
    renderMagicLinkPage('');
    expect(screen.getByText('Link expired or invalid')).toBeInTheDocument();
    expect(screen.getByText(EXPIRED_COPY)).toBeInTheDocument();
  });

  it('shows loading state while validating token', () => {
    mockValidateMagicToken.mockReturnValue(new Promise(() => {}));
    renderMagicLinkPage('?token=abc123');
    expect(
      screen.getByRole('heading', { name: 'Verifying your link' })
    ).toBeInTheDocument();
  });

  it('renders when localStorage access throws (locked-down Safari)', () => {
    mockValidateMagicToken.mockReturnValue(new Promise(() => {}));
    const throwingStorage = new Proxy(
      {},
      {
        get() {
          throw new ReferenceError("Can't find variable: localStorage");
        },
      }
    );
    vi.stubGlobal('localStorage', throwingStorage);
    try {
      renderMagicLinkPage('?token=abc123');
      expect(
        screen.getByRole('heading', { name: 'Verifying your link' })
      ).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('announces the verifying state to screen readers', () => {
    mockValidateMagicToken.mockReturnValue(new Promise(() => {}));
    renderMagicLinkPage('?token=abc123');
    expect(screen.getByRole('status')).toHaveTextContent('Verifying your link');
  });

  it('shows the expired page in the reader’s language, not the server’s English', async () => {
    mockValidateMagicToken.mockResolvedValue(
      answer(400, {
        message: 'This link is invalid or has expired.',
        code: 'expired',
      })
    );
    renderMagicLinkPage('?token=expired');

    await waitFor(() => {
      expect(screen.getByText('Link expired or invalid')).toBeInTheDocument();
    });
    expect(screen.getByText(EXPIRED_COPY)).toBeInTheDocument();
    expect(
      screen.queryByText('This link is invalid or has expired.')
    ).not.toBeInTheDocument();
  });

  describe('when the link needs a confirming click', () => {
    it('asks which account to sign in to before using the link', async () => {
      mockValidateMagicToken.mockResolvedValue(answer(428, CONFIRM_LOGIN));
      renderMagicLinkPage('?token=abc123');

      expect(
        await screen.findByRole('heading', {
          name: 'Sign in to 2anki as l•••@example.com?',
        })
      ).toBeInTheDocument();
      expect(
        screen.getByText("Confirm it's you to finish signing in.")
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
      expect(
        screen.queryByText(
          'Open the link in your email again to finish signing in.'
        )
      ).not.toBeInTheDocument();
      expect(mockConfirmMagicLink).not.toHaveBeenCalled();
    });

    it('moves focus to the question so a screen reader announces it', async () => {
      mockValidateMagicToken.mockResolvedValue(answer(428, CONFIRM_LOGIN));
      renderMagicLinkPage('?token=abc123');

      const heading = await screen.findByRole('heading', {
        name: 'Sign in to 2anki as l•••@example.com?',
      });

      await waitFor(() => {
        expect(heading).toHaveFocus();
      });
    });

    it('signs in on the click and follows the redirect', async () => {
      vi.stubGlobal('location', { href: '' });
      mockValidateMagicToken.mockResolvedValue(answer(428, CONFIRM_LOGIN));
      mockConfirmMagicLink.mockResolvedValue(
        answer(200, { token: 'jwt-tok', redirect: '/upload' })
      );
      renderMagicLinkPage('?token=abc123&redirect=/upload');

      fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

      await waitFor(() => {
        expect(globalThis.location.href).toBe('/upload');
      });
      expect(mockConfirmMagicLink).toHaveBeenCalledWith('abc123', '/upload');
    });

    it('disables the button and says it is checking while the click is pending', async () => {
      mockValidateMagicToken.mockResolvedValue(answer(428, CONFIRM_LOGIN));
      mockConfirmMagicLink.mockReturnValue(new Promise(() => {}));
      renderMagicLinkPage('?token=abc123');

      fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

      expect(
        await screen.findByRole('button', { name: 'Checking your link' })
      ).toBeDisabled();
    });

    it('offers a password reset for a reset link and opens the reset page', async () => {
      vi.stubGlobal('location', { href: '' });
      mockValidateMagicToken.mockResolvedValue(
        answer(428, { ...CONFIRM_LOGIN, purpose: 'password_reset' })
      );
      mockConfirmMagicLink.mockResolvedValue(
        answer(200, { purpose: 'password_reset', reset_token: 'reset-1' })
      );
      renderMagicLinkPage('?token=abc123');

      expect(
        await screen.findByRole('heading', {
          name: 'Reset the password for l•••@example.com?',
        })
      ).toBeInTheDocument();
      expect(
        screen.getByText("Confirm it's you to choose a new password.")
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

      await waitFor(() => {
        expect(globalThis.location.href).toBe('/users/r/reset-1');
      });
    });

    it('shows the expired page when the confirm is refused', async () => {
      mockValidateMagicToken.mockResolvedValue(answer(428, CONFIRM_LOGIN));
      mockConfirmMagicLink.mockResolvedValue(answer(400, { code: 'expired' }));
      renderMagicLinkPage('?token=abc123');

      fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

      expect(await screen.findByText(EXPIRED_COPY)).toBeInTheDocument();
    });

    it.each([
      ['rate-limited', 429],
      ['refused as cross-site', 403],
      ['hit a server error', 500],
    ])(
      'keeps the link usable when the confirm is %s',
      async (_label, status) => {
        mockValidateMagicToken.mockResolvedValue(answer(428, CONFIRM_LOGIN));
        mockConfirmMagicLink.mockResolvedValueOnce(
          answer(status, { message: 'Too many attempts.' })
        );
        renderMagicLinkPage('?token=abc123');

        fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(RETRY_COPY);
        expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
        expect(screen.queryByText(EXPIRED_COPY)).not.toBeInTheDocument();
      }
    );

    it('signs in when the person tries again after the wait', async () => {
      vi.stubGlobal('location', { href: '' });
      mockValidateMagicToken.mockResolvedValue(answer(428, CONFIRM_LOGIN));
      mockConfirmMagicLink
        .mockResolvedValueOnce(answer(429, {}))
        .mockResolvedValueOnce(answer(200, { token: 'jwt-tok' }));
      renderMagicLinkPage('?token=abc123');

      fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
      await screen.findByRole('alert');
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

      await waitFor(() => {
        expect(globalThis.location.href).toBe('/search');
      });
    });

    it('keeps the link usable when the confirm cannot reach the server', async () => {
      mockValidateMagicToken.mockResolvedValue(answer(428, CONFIRM_LOGIN));
      mockConfirmMagicLink.mockRejectedValue(new Error('offline'));
      renderMagicLinkPage('?token=abc123');

      fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(RETRY_COPY);
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    });
  });

  it('sends someone already signed in as the link’s owner into the app', async () => {
    vi.stubGlobal('location', { href: '' });
    mockValidateMagicToken.mockResolvedValue(
      answer(409, {
        message: "You're already signed in. Open 2anki to continue.",
        signedIn: true,
        redirect: '/upload',
      })
    );
    renderMagicLinkPage('?token=abc123');

    await waitFor(() => {
      expect(globalThis.location.href).toBe('/upload');
    });
  });

  it('shows send a new link form on error', async () => {
    mockValidateMagicToken.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: 'Expired' }),
    });
    renderMagicLinkPage('?token=bad');

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Send a new link' })
      ).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('Email address')).toBeInTheDocument();
  });

  it('confirms a new link was sent when the resend succeeds, keeping an MCP connector redirect', async () => {
    mockValidateMagicToken.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: 'Expired' }),
    });
    mockRequestMagicLink.mockResolvedValue({ ok: true, status: 200 });
    renderMagicLinkPage(
      '?token=bad&redirect=%2Fmcp%2Fauthorize%3Fclient_id%3Dabc'
    );

    fireEvent.change(await screen.findByPlaceholderText('Email address'), {
      target: { value: 'reader@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));

    expect(
      await screen.findByText('A new link has been sent to reader@example.com.')
    ).toBeInTheDocument();
    expect(mockRequestMagicLink).toHaveBeenCalledWith(
      'reader@example.com',
      'login',
      '/mcp/authorize?client_id=abc'
    );
  });

  it('says a new link could not be sent when the resend fails', async () => {
    mockValidateMagicToken.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: 'Expired' }),
    });
    mockRequestMagicLink.mockResolvedValue({ ok: false, status: 500 });
    renderMagicLinkPage('?token=bad');

    fireEvent.change(await screen.findByPlaceholderText('Email address'), {
      target: { value: 'reader@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));

    expect(
      await screen.findByText('Could not send a new link. Try again.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/New link sent/)).not.toBeInTheDocument();
  });

  it('shows back to login link on error', async () => {
    mockValidateMagicToken.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });
    renderMagicLinkPage('?token=bad');

    await waitFor(() => {
      expect(screen.getByText('Back to login')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Back to login' })).toHaveAttribute(
      'href',
      '/login'
    );
  });

  it('shows error when network request fails', async () => {
    mockValidateMagicToken.mockRejectedValue(new Error('Network error'));
    renderMagicLinkPage('?token=abc123');

    await waitFor(() => {
      expect(screen.getByText('Link expired or invalid')).toBeInTheDocument();
    });
    expect(
      screen.getByText('Something went wrong. Try again.')
    ).toBeInTheDocument();
  });

  it('forwards the redirect to the verify endpoint and navigates to the returned redirect', async () => {
    vi.stubGlobal('location', { href: '' });
    mockValidateMagicToken.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'jwt-tok', redirect: '/upload' }),
    });
    renderMagicLinkPage('?token=abc123&redirect=/upload');

    await waitFor(() => {
      expect(globalThis.location.href).toBe('/upload');
    });
    expect(mockValidateMagicToken).toHaveBeenCalledWith('abc123', '/upload');
  });

  it('falls back to the default search path when no redirect is returned', async () => {
    vi.stubGlobal('location', { href: '' });
    mockValidateMagicToken.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'jwt-tok' }),
    });
    renderMagicLinkPage('?token=abc123');

    await waitFor(() => {
      expect(globalThis.location.href).toBe('/search');
    });
  });

  it('ignores an unsafe redirect echoed by the server and uses the default', async () => {
    vi.stubGlobal('location', { href: '' });
    mockValidateMagicToken.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ token: 'jwt-tok', redirect: 'https://evil.example' }),
    });
    renderMagicLinkPage('?token=abc123&redirect=https://evil.example');

    await waitFor(() => {
      expect(globalThis.location.href).toBe('/search');
    });
  });

  it('does not forward an unsafe redirect from the URL to the verify endpoint', async () => {
    vi.stubGlobal('location', { href: '' });
    mockValidateMagicToken.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'jwt-tok' }),
    });
    renderMagicLinkPage('?token=abc123&redirect=//evil.example');

    await waitFor(() => {
      expect(mockValidateMagicToken).toHaveBeenCalledWith('abc123', undefined);
    });
  });

  it('opens the link once even when effects run twice in strict mode', async () => {
    vi.stubGlobal('location', { href: '' });
    mockValidateMagicToken.mockResolvedValue(answer(200, { token: 'jwt-tok' }));
    render(
      <StrictMode>
        <CookiesProvider>
          <MemoryRouter initialEntries={['/auth/magic?token=once']}>
            <MagicLinkPage />
          </MemoryRouter>
        </CookiesProvider>
      </StrictMode>
    );

    await waitFor(() => {
      expect(globalThis.location.href).toBe('/search');
    });
    expect(mockValidateMagicToken).toHaveBeenCalledTimes(1);
  });

  it('strips the token from the address bar after reading it', async () => {
    globalThis.history.replaceState(null, '', '/auth/magic?token=secret-value');
    mockValidateMagicToken.mockReturnValue(new Promise(() => {}));
    renderMagicLinkPage('?token=secret-value');

    await waitFor(() => {
      expect(globalThis.location.search).not.toContain('token');
    });
    expect(globalThis.location.pathname).toBe('/auth/magic');
  });
});
