import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/analytics/track', () => ({ track: vi.fn() }));

vi.mock('../../lib/backend/getUserLocals', () => ({
  getUserLocals: vi.fn(),
}));

import { getUserLocals } from '../../lib/backend/getUserLocals';
import { useUserLocals } from '../../lib/hooks/useUserLocals';
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

describe('HomePage upload sent on to the limit page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.localStorage.clear();
  });

  it('keeps the limit screen on the home page, with the actions for the session the server saw, when that session signed in elsewhere', async () => {
    let session: Locals = signedOut;
    mockGetUserLocals.mockImplementation(() => Promise.resolve(session));
    const uploads: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/upload/file') {
          uploads.push(url);
          return Promise.resolve({
            redirected: true,
            url: 'http://localhost/limit?kind=card_count',
            status: 200,
            headers: new Headers({}),
          });
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      })
    );
    const queryClient = new QueryClient();
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
    await waitFor(() =>
      expect(queryClient.getQueryState(['userLocals'])?.status).toBe('success')
    );

    session = signedInElsewhere;
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

    expect(
      await screen.findByRole('button', { name: /Get Day Pass/ })
    ).toBeInTheDocument();
    expect(uploads).toHaveLength(1);
    expect(screen.queryByText('The upload page')).toBeNull();
    expect(
      screen.queryByRole('link', { name: 'Create a free account' })
    ).toBeNull();
    expect(queryClient.getQueryData(['userLocals'])).toEqual(signedOut);
  });
});
