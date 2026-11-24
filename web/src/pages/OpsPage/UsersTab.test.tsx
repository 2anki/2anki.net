import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import UsersTab from './UsersTab';

const BLOCK_ID_URL = '/api/ops/set-block-id-identity';
const CHANGE_EMAIL_URL = '/api/ops/change-user-email';
const GRANT_PASS_URL = '/api/ops/grant-unclaimed-pass';

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = vi
    .fn()
    .mockImplementation(async (url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => handler(url, init),
    }));
}

const renderTab = () =>
  render(
    <MemoryRouter>
      <UsersTab />
    </MemoryRouter>
  );

describe('UsersTab — match cards to Notion blocks', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockFetch((url) =>
      url === BLOCK_ID_URL ? { userId: 21, blockIdIdentity: true } : {}
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('turns the option on for the typed email and tells support what to say', async () => {
    renderTab();

    fireEvent.change(screen.getByLabelText('Match cards account email'), {
      target: { value: 'learner@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(
      await screen.findByText(
        'On for learner@example.com. Ask them to upload the same page again — their existing cards update in place.'
      )
    ).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      BLOCK_ID_URL,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'learner@example.com', enabled: true }),
      })
    );
  });

  test('turns the option off and says the user’s own setting applies again', async () => {
    mockFetch((url) =>
      url === BLOCK_ID_URL ? { userId: 21, blockIdIdentity: false } : {}
    );
    renderTab();

    fireEvent.change(screen.getByLabelText('Match cards account email'), {
      target: { value: 'learner@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    expect(
      await screen.findByText(
        'Off for learner@example.com. Their own card option setting applies again.'
      )
    ).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      BLOCK_ID_URL,
      expect.objectContaining({
        body: JSON.stringify({ email: 'learner@example.com', enabled: false }),
      })
    );
  });

  test('asks for the email before calling the server', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(
      await screen.findByText('Enter the account email first.')
    ).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      BLOCK_ID_URL,
      expect.anything()
    );
  });
});

describe('UsersTab — change account email', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockFetch((url) => (url === CHANGE_EMAIL_URL ? { userId: 42 } : {}));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('changes the email and reports the account stays linked', async () => {
    renderTab();

    fireEvent.change(screen.getByLabelText('Current account email'), {
      target: { value: 'old@example.com' },
    });
    fireEvent.change(screen.getByLabelText('New account email'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));

    expect(
      await screen.findByText(
        'Account 42 now signs in with new@example.com. Their subscription stays linked; no email was sent.'
      )
    ).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      CHANGE_EMAIL_URL,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          currentEmail: 'old@example.com',
          newEmail: 'new@example.com',
        }),
      })
    );
  });

  test('asks for the new email before calling the server', async () => {
    renderTab();

    fireEvent.change(screen.getByLabelText('Current account email'), {
      target: { value: 'old@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));

    expect(
      await screen.findByText('Enter the new email first.')
    ).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      CHANGE_EMAIL_URL,
      expect.anything()
    );
  });
});

describe('UsersTab — grant unclaimed pass', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockFetch((url) =>
      url === GRANT_PASS_URL
        ? {
            granted: true,
            userId: 7,
            kind: 'week',
            expiresAt: '2026-12-01T00:00:00.000Z',
          }
        : {}
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('grants the pass id to the typed email', async () => {
    renderTab();

    fireEvent.change(screen.getByLabelText('Anonymous pass id'), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByLabelText('Account email'), {
      target: { value: 'buyer@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Grant pass' }));

    expect(
      await screen.findByText(/Granted a week pass to account 7/)
    ).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      GRANT_PASS_URL,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          anonymousPassId: 12,
          email: 'buyer@example.com',
        }),
      })
    );
  });

  test('asks for a numeric pass id before calling the server', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Grant pass' }));

    expect(
      await screen.findByText('Enter a numeric pass id first.')
    ).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('UsersTab — layout', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test.each([
    'Grant unclaimed pass',
    'Match cards to Notion blocks',
    'Change account email',
    'Delete account',
  ])('hosts the %s tool', (title) => {
    mockFetch(() => ({}));
    renderTab();

    expect(
      screen.getByRole('heading', { level: 3, name: title })
    ).toBeInTheDocument();
  });

  test('leaves the batch jobs and site commands to the Commands page', () => {
    mockFetch(() => ({}));
    renderTab();

    expect(screen.getByText('Users', { selector: 'p' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Inactivity warnings' })
    ).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Stripe subscriptions' })
    ).toBeNull();
  });
});
