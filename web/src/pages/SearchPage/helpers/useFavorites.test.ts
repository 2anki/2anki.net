// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Backend from '../../../lib/backend';
import useFavorites from './useFavorites';

function makeMockBackend(): Backend {
  return {
    getFavorites: vi.fn().mockResolvedValue([]),
  } as unknown as Backend;
}

describe('useFavorites', () => {
  it('calls getFavorites when enabled is true', async () => {
    const backend = makeMockBackend();
    renderHook(() => useFavorites(backend, true));
    await new Promise((r) => setTimeout(r, 10));
    expect(backend.getFavorites).toHaveBeenCalledTimes(1);
  });

  it('does not call getFavorites when enabled is false', async () => {
    const backend = makeMockBackend();
    renderHook(() => useFavorites(backend, false));
    await new Promise((r) => setTimeout(r, 10));
    expect(backend.getFavorites).not.toHaveBeenCalled();
  });
});
