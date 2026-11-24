import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

import CommandsTab from './CommandsTab';

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
      <CommandsTab />
    </MemoryRouter>
  );

describe('CommandsTab — delete inactive accounts', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('keeps the delete button locked until a dry run finds candidates, then confirms with the count', async () => {
    const confirmSpy = vi
      .spyOn(globalThis, 'confirm')
      .mockImplementation(() => true);
    mockFetch((url) =>
      url.includes('dryRun=true')
        ? { count: 42, dryRun: true }
        : { count: 42, dryRun: false }
    );
    renderTab();

    const deleteButton = screen.getByRole('button', {
      name: 'Delete inactive accounts',
    });
    expect(deleteButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Check candidates' }));
    expect(
      await screen.findByText('42 accounts would be deleted.')
    ).toBeInTheDocument();
    expect(deleteButton).toBeEnabled();

    fireEvent.click(deleteButton);
    expect(confirmSpy).toHaveBeenCalledWith(
      'Permanently delete 42 accounts? This cannot be undone.'
    );
    expect(await screen.findByText('Deleted 42 accounts.')).toBeInTheDocument();
    expect(deleteButton).toBeDisabled();
  });

  test('re-locks the delete button when a later dry run fails', async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      if (calls === 1) return { count: 3, dryRun: true };
      throw new Error('db down');
    });
    renderTab();

    const check = screen.getByRole('button', { name: 'Check candidates' });
    fireEvent.click(check);
    expect(
      await screen.findByText('3 accounts would be deleted.')
    ).toBeInTheDocument();
    fireEvent.click(check);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Delete inactive accounts' })
      ).toBeDisabled()
    );
  });

  test('keeps the delete button locked when the dry run finds nothing', async () => {
    mockFetch(() => ({ count: 0, dryRun: true }));
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Check candidates' }));
    expect(
      await screen.findByText('0 accounts would be deleted.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete inactive accounts' })
    ).toBeDisabled();
  });
});

describe('CommandsTab — layout', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('groups the jobs and site commands and leaves the per-account tools to the Users page', () => {
    mockFetch(() => ({}));
    renderTab();

    expect(
      screen.getByRole('heading', { level: 2, name: /Run a job/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /^Site/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Support a user' })
    ).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Change account email' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check passes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check value' })).toBeNull();
  });

  test.each([
    'Confirm email notice',
    'Inactivity warnings',
    'Stripe subscriptions',
    'Delete inactive accounts',
    'Verify dead upload rows',
    'Orphaned subscriptions',
  ])('keeps the %s command', (title) => {
    mockFetch(() => ({}));
    renderTab();

    expect(
      screen.getByRole('heading', { level: 3, name: title })
    ).toBeInTheDocument();
  });
});

describe('CommandsTab — confirm email notice', () => {
  const originalFetch = globalThis.fetch;
  const noticeResult = {
    count: 30,
    failed: 0,
    suppressed: 0,
    alreadyRunning: false,
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('counts recipients without sending or asking', async () => {
    const confirmSpy = vi.spyOn(globalThis, 'confirm');
    mockFetch(() => ({ ...noticeResult, dryRun: true }));
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Count recipients' }));

    expect(
      await screen.findByText('30 accounts would get the notice.')
    ).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/send-confirm-email-notices?dryRun=true',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('sends nothing when the confirmation is dismissed', () => {
    vi.spyOn(globalThis, 'confirm').mockImplementation(() => false);
    mockFetch(() => ({ ...noticeResult, dryRun: false }));
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Send notice' }));

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('reports sent, failed and suppressed after a confirmed send', async () => {
    vi.spyOn(globalThis, 'confirm').mockImplementation(() => true);
    mockFetch(() => ({
      ...noticeResult,
      failed: 2,
      suppressed: 1,
      dryRun: false,
    }));
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Send notice' }));

    expect(
      await screen.findByText(
        'Notice sent to 30 accounts. 2 failed, 1 suppressed.'
      )
    ).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/send-confirm-email-notices?dryRun=false',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('says so when another run is sending', async () => {
    vi.spyOn(globalThis, 'confirm').mockImplementation(() => true);
    mockFetch(() => ({
      ...noticeResult,
      count: 0,
      alreadyRunning: true,
      dryRun: false,
    }));
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Send notice' }));

    expect(
      await screen.findByText(
        'Another run is sending. Nothing was sent from this one.'
      )
    ).toBeInTheDocument();
  });

  test('shows the server message when the job fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({ message: 'Could not run the confirm email job.' }),
    });
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Count recipients' }));

    expect(
      await screen.findByText('Could not run the confirm email job.')
    ).toBeInTheDocument();
  });
});

describe('CommandsTab — prune dead upload rows', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('frames the panel as a between-sweeps check, not the primary cleanup', () => {
    renderTab();

    expect(
      screen.getByRole('heading', { name: 'Verify dead upload rows' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/daily self-heal removes these automatically/i)
    ).toBeInTheDocument();
  });

  test('keeps the prune button locked until a check finds dead rows, then confirms with the count', async () => {
    const confirmSpy = vi
      .spyOn(globalThis, 'confirm')
      .mockImplementation(() => true);
    mockFetch((_url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return body.dryRun
        ? { dryRun: true, missingRows: 5, sampleKeys: ['decks/a.apkg'] }
        : { dryRun: false, deleted: 5 };
    });
    renderTab();

    const pruneButton = screen.getByRole('button', { name: 'Prune dead rows' });
    expect(pruneButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Check dead rows' }));
    expect(
      await screen.findByText(
        '5 upload rows point at a deleted file and would be removed.'
      )
    ).toBeInTheDocument();
    expect(pruneButton).toBeEnabled();

    fireEvent.click(pruneButton);
    expect(confirmSpy).toHaveBeenCalledWith(
      'Remove 5 dead upload rows? The files are already gone; this only clears the rows that 404 on download.'
    );
    expect(
      await screen.findByText('Removed 5 dead upload rows.')
    ).toBeInTheDocument();
    expect(pruneButton).toBeDisabled();
  });

  test('keeps the prune button locked when the check finds nothing', async () => {
    mockFetch(() => ({ dryRun: true, missingRows: 0, sampleKeys: [] }));
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Check dead rows' }));
    expect(
      await screen.findByText(
        '0 upload rows point at a deleted file and would be removed.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Prune dead rows' })
    ).toBeDisabled();
  });
});
