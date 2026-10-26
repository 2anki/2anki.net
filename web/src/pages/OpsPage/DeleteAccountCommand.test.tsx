import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

import DeleteAccountCommand from './DeleteAccountCommand';

const account = {
  userId: 4242,
  createdAt: '2026-10-26T06:00:00.000Z',
  lastLoginAt: null,
  activeSubscription: false,
  activePass: null,
  jobs: 0,
  uploads: 0,
};

type Reply = { ok?: boolean; status?: number; body: unknown };

function mockFetch(replies: Reply[]) {
  globalThis.fetch = vi.fn().mockImplementation(async () => {
    const next = replies.shift() ?? { body: {} };
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      statusText: '',
      json: async () => next.body,
    };
  });
}

const sentBodies = () =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.map(([, init]) => JSON.parse(String(init?.body)));

const previewFor = async (email: string) => {
  fireEvent.change(screen.getByLabelText('Account email to delete'), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview account' }));
  await screen.findByLabelText('Confirm account email');
};

describe('DeleteAccountCommand', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('previews first and keeps Delete disabled until the email is typed again', async () => {
    mockFetch([{ body: { dryRun: true, account } }]);
    render(<DeleteAccountCommand />);

    await previewFor('target@example.com');

    expect(screen.getByText(/Account 4242/)).toHaveTextContent(
      'last login never'
    );
    expect(sentBodies()[0]).toEqual({
      email: 'target@example.com',
      dryRun: true,
    });
    const deleteButton = screen.getByRole('button', { name: 'Delete account' });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Confirm account email'), {
      target: { value: 'other@example.com' },
    });
    expect(deleteButton).toBeDisabled();
  });

  test('deletes after the typed confirmation and reports the account id', async () => {
    mockFetch([
      { body: { dryRun: true, account } },
      { body: { dryRun: false, userId: 4242 } },
    ]);
    render(<DeleteAccountCommand />);

    await previewFor('target@example.com');
    fireEvent.change(screen.getByLabelText('Confirm account email'), {
      target: { value: 'Target@Example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(
      await screen.findByText(
        'Deleted account 4242. Any Stripe subscription was cancelled first.'
      )
    ).toBeInTheDocument();
    expect(sentBodies()[1]).toEqual({
      email: 'target@example.com',
      confirmEmail: 'Target@Example.com',
      dryRun: false,
      force: false,
    });
  });

  test('needs the force box for an account with paid access', async () => {
    mockFetch([
      {
        body: {
          dryRun: true,
          account: { ...account, activeSubscription: true },
        },
      },
      { body: { dryRun: false, userId: 4242 } },
    ]);
    render(<DeleteAccountCommand />);

    await previewFor('target@example.com');
    fireEvent.change(screen.getByLabelText('Confirm account email'), {
      target: { value: 'target@example.com' },
    });
    const deleteButton = screen.getByRole('button', { name: 'Delete account' });
    expect(deleteButton).toBeDisabled();

    fireEvent.click(
      screen.getByLabelText('Delete even though it has paid access')
    );
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);

    await screen.findByText(/Deleted account 4242/);
    expect(sentBodies()[1]).toMatchObject({ force: true });
  });

  test('shows the server message when no account matches', async () => {
    mockFetch([
      {
        ok: false,
        status: 404,
        body: { message: 'No account found for that email.' },
      },
    ]);
    render(<DeleteAccountCommand />);

    fireEvent.change(screen.getByLabelText('Account email to delete'), {
      target: { value: 'nobody@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview account' }));

    expect(
      await screen.findByText('No account found for that email.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete account' })
    ).not.toBeInTheDocument();
  });

  test('editing the email throws away the preview', async () => {
    mockFetch([{ body: { dryRun: true, account } }]);
    render(<DeleteAccountCommand />);

    await previewFor('target@example.com');
    fireEvent.change(screen.getByLabelText('Account email to delete'), {
      target: { value: 'target2@example.com' },
    });

    expect(
      screen.queryByRole('button', { name: 'Delete account' })
    ).not.toBeInTheDocument();
  });
});
