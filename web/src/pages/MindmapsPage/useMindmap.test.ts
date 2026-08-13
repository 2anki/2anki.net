import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const { mockGet, mockPost, mockPatch, mockDel } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPatch: vi.fn(),
  mockDel: vi.fn(),
}));

vi.mock('../../lib/backend/api', () => ({
  get: mockGet,
  post: mockPost,
  patch: mockPatch,
  del: mockDel,
}));

import { useMindmapList, exportMindmap } from './useMindmap';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useMindmapList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns maps and access block from server response', async () => {
    const serverResponse = {
      maps: [
        {
          id: 'uuid-1',
          user_id: 42,
          title: 'Anatomy',
          data: { nodes: [], edges: [] },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      access: {
        hasUnlimited: false,
        currentCount: 1,
        freeMapLimit: 3,
        maxNodesPerMap: 50,
      },
    };
    mockGet.mockResolvedValue(serverResponse);

    const { result } = renderHook(() => useMindmapList(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.maps).toHaveLength(1);
    expect(result.current.data?.access.freeMapLimit).toBe(3);
    expect(result.current.data?.access.maxNodesPerMap).toBe(50);
    expect(result.current.data?.access.hasUnlimited).toBe(false);
  });

  it('calls the correct API endpoint', async () => {
    mockGet.mockResolvedValue({
      maps: [],
      access: {
        hasUnlimited: false,
        currentCount: 0,
        freeMapLimit: 3,
        maxNodesPerMap: 50,
      },
    });

    renderHook(() => useMindmapList(), { wrapper: createWrapper() });

    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/mindmaps'));
  });
});

describe('exportMindmap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function stubFetch(headers: Record<string, string>) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('deck', { status: 200, headers })
    );
  }

  it('parses the excluded node count from the response header', async () => {
    stubFetch({ 'X-Excluded-Node-Count': '3' });

    const result = await exportMindmap('map-1', 'My deck', 'basic');

    expect(result.excludedNodeCount).toBe(3);
    expect(await result.blob.text()).toBe('deck');
  });

  it('defaults the excluded node count to 0 when the header is absent', async () => {
    stubFetch({});

    const result = await exportMindmap('map-1', 'My deck', 'cloze');

    expect(result.excludedNodeCount).toBe(0);
  });

  it('throws when the export request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500, statusText: 'Server Error' })
    );

    await expect(exportMindmap('map-1', 'My deck', 'basic')).rejects.toThrow(
      /Export failed/
    );
  });
});
