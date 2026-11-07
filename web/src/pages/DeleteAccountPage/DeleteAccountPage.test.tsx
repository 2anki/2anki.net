import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Cookies from 'universal-cookie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteAccountPage } from './DeleteAccountPage';
import {
  getLastDeckStore,
  resetLastDeckStoreForTests,
} from '../../lib/upload/lastDeck';
import { resetPendingUploadStoreForTests } from '../../lib/upload/pendingUpload';

const keptDeck = {
  recoveryToken: '0b6f2c1e-3a4d-4e5f-8a9b-1c2d3e4f5a6b',
  deckName: 'Biology.apkg',
  savedAt: Date.now(),
};

function confirmDeletion() {
  const button = screen.getByRole('button');
  fireEvent.click(button);
  fireEvent.click(button);
}

describe('DeleteAccountPage', () => {
  const location = { href: '' };

  beforeEach(() => {
    location.href = '';
    resetLastDeckStoreForTests();
    resetPendingUploadStoreForTests();
    vi.stubGlobal('location', location);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetLastDeckStoreForTests();
    resetPendingUploadStoreForTests();
  });

  it('shows the refusal and stays signed in when the account was not deleted', async () => {
    const refusal = 'A plan is billed to this email.';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: refusal }), { status: 409 })
        )
    );
    new Cookies().set('token', 'kept');
    const setError = vi.fn();
    render(<DeleteAccountPage setError={setError} />);

    confirmDeletion();

    await waitFor(() => expect(setError).toHaveBeenCalled());
    expect(setError.mock.calls[0][0]).toMatchObject({ message: refusal });
    expect(location.href).toBe('');
    expect(new Cookies().get('token')).toBe('kept');
  });

  it('forgets the deck a signed-out pass bought on this device', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await getLastDeckStore().save(keptDeck);
    render(<DeleteAccountPage setError={vi.fn()} />);

    confirmDeletion();

    await waitFor(() => expect(location.href).toBe('/'));
    expect(await getLastDeckStore().load()).toBeNull();
  });

  it('still leaves the page when the browser store never answers', async () => {
    const open = vi.fn(() => ({}) as IDBOpenDBRequest);
    vi.stubGlobal('indexedDB', { open } as unknown as IDBFactory);
    render(<DeleteAccountPage setError={vi.fn()} />);

    confirmDeletion();

    await waitFor(() => expect(location.href).toBe('/'), { timeout: 3000 });
    expect(open).toHaveBeenCalled();
  });
});
