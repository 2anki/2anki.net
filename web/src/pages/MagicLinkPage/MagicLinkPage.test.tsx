import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CookiesProvider } from 'react-cookie';
import MagicLinkPage from './MagicLinkPage';

const mockValidateMagicToken = vi.fn();
const mockRequestMagicLink = vi.fn();

vi.mock('../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    validateMagicToken: mockValidateMagicToken,
    requestMagicLink: mockRequestMagicLink,
  }),
}));

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
  });

  it('shows error when no token is present', () => {
    renderMagicLinkPage('');
    expect(screen.getByText('Link expired or invalid')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This link is invalid or has expired. Request a new one.'
      )
    ).toBeInTheDocument();
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

  it('shows error state on failed validation', async () => {
    mockValidateMagicToken.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: 'Token has expired' }),
    });
    renderMagicLinkPage('?token=expired');

    await waitFor(() => {
      expect(screen.getByText('Link expired or invalid')).toBeInTheDocument();
    });
    expect(screen.getByText('Token has expired')).toBeInTheDocument();
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
