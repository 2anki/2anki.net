import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

vi.mock('../../lib/backend/getUserLocals', () => ({
  getUserLocals: vi.fn(),
}));

import { getUserLocals } from '../../lib/backend/getUserLocals';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
import { getPendingUploadStore } from '../../lib/upload/pendingUpload';
import { HomePage } from './HomePage';

const mockGetUserLocals = vi.mocked(getUserLocals);

type Locals = Awaited<ReturnType<typeof getUserLocals>>;

const signedOut = {
  user: null,
  locals: { owner: 0, patreon: false, subscriber: false },
  features: {},
} as unknown as Locals;

const signedInElsewhere = {
  user: { id: 8, email: 'free@example.com' },
  locals: { owner: 8, patreon: false, subscriber: false },
  features: {},
} as unknown as Locals;

// The home page as App mounts it: signed-in visitors are sent to /upload.
function Home() {
  const { data } = useUserLocals();
  return (
    <HomePage setErrorMessage={vi.fn()} isLoggedIn={data?.user?.id != null} />
  );
}

describe('HomePage upload while the account read is failing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    globalThis.localStorage.clear();
  });

  it('keeps the page and its upload where they are when the fresh read before sending finds an account signed in elsewhere', async () => {
    let accountReads: 'failing' | 'signed in elsewhere' = 'failing';
    mockGetUserLocals.mockImplementation(() =>
      accountReads === 'failing'
        ? Promise.reject(new Error('locals'))
        : Promise.resolve(signedInElsewhere)
    );
    const uploads: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/upload/file') {
          uploads.push(url);
          return new Promise<never>(() => {});
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      })
    );
    const queryClient = new QueryClient();
    queryClient.setQueryData(['userLocals'], signedOut);
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/upload" element={<p>The upload page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(queryClient.getQueryState(['userLocals'])?.status).toBe('error');

    accountReads = 'signed in elsewhere';
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['<p>notes</p>'], 'notes.html')],
      configurable: true,
    });
    input.removeAttribute('required');
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(uploads).toHaveLength(1);
    expect(screen.queryByText('The upload page')).toBeNull();
    expect(
      screen.getByRole('heading', { level: 1, name: /flashcards/i })
    ).toBeInTheDocument();
    expect(queryClient.getQueryData(['userLocals'])).toEqual(signedOut);
    expect(await getPendingUploadStore().load()).toMatchObject({
      filename: 'notes.html',
      ownerId: 8,
      ownerUnknown: false,
    });
  });
});
