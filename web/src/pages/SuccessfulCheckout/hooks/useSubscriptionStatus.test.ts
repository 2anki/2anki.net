import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useSubscriptionStatus', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      configurable: true,
      value: { href: '', search: '' },
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('strips session_id from the address bar after capturing it', async () => {
    const replaceState = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      configurable: true,
      value: {
        href: 'https://2anki.net/successful-checkout?session_id=cs_test_xyz',
        pathname: '/successful-checkout',
        search: '?session_id=cs_test_xyz',
        hash: '',
      },
    });
    Object.defineProperty(globalThis, 'history', {
      writable: true,
      configurable: true,
      value: { state: null, replaceState },
    });

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ authenticated: false, hasActiveSubscription: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const { useSubscriptionStatus } = await import('./useSubscriptionStatus');
    renderHook(() => useSubscriptionStatus(), { wrapper: buildWrapper() });

    await waitFor(() => {
      expect(replaceState).toHaveBeenCalledWith(
        null,
        '',
        '/successful-checkout'
      );
    });
  });

  it('redirects straight to the account page when the session was already confirmed', async () => {
    Object.defineProperty(globalThis, 'location', {
      writable: true,
      configurable: true,
      value: { href: '', search: '?session_id=sess_abc123' },
    });
    sessionStorage.setItem('purchase_fired_sess_abc123', '1');

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          authenticated: true,
          hasActiveSubscription: true,
          user: { email: 'a@b.com', name: 'Alex', patreon: false },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const { useSubscriptionStatus } = await import('./useSubscriptionStatus');
    const { result } = renderHook(() => useSubscriptionStatus(), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => {
      expect(globalThis.location.href).toBe('/account?subscribed=1');
    });
    expect(result.current.showConfirmation).toBe(false);
  });
});
