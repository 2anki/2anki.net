import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import CommandsTab from './CommandsTab';

const BLOCK_ID_URL = '/api/ops/set-block-id-identity';

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

describe('CommandsTab — match cards to Notion blocks', () => {
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

    await waitFor(() =>
      expect(
        screen.getByText(
          'On for learner@example.com. Ask them to upload the same page again — their existing cards update in place.'
        )
      ).toBeInTheDocument()
    );
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

    await waitFor(() =>
      expect(
        screen.getByText(
          'Off for learner@example.com. Their own card option setting applies again.'
        )
      ).toBeInTheDocument()
    );
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
