// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useErrorGroups } from './useErrorGroups';

describe('useErrorGroups', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ groups: [], totalGroups: 0 }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('sends the resolution status as a query param', async () => {
    renderHook(() =>
      useErrorGroups({ source: 'all', sort: 'last_seen', status: 'resolved' })
    );

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).toContain('status=resolved');
  });

  test('omits the source param when source is all', async () => {
    renderHook(() =>
      useErrorGroups({ source: 'all', sort: 'last_seen', status: 'unresolved' })
    );

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledUrl).not.toContain('source=');
    expect(calledUrl).toContain('status=unresolved');
  });
});
