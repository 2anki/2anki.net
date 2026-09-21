import { act, renderHook, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import useSearchQuery, { QUERY_KEY } from './useSearchQuery';
import type Backend from '../../../lib/backend';
import type NotionObject from '../../../lib/interfaces/NotionObject';

const mockBackend = {
  search: vi.fn(),
  searchTopLevelPages: vi.fn(),
} as unknown as Backend;

const mockSetError = vi.fn();

const notionPage = (id: string, title: string): NotionObject => ({
  id,
  title,
  object: 'page',
  url: '',
});

describe('useSearchQuery ?q= mount behaviour', () => {
  beforeEach(() => {
    mockBackend.search = vi.fn().mockResolvedValue([]);
    mockBackend.searchTopLevelPages = vi.fn().mockResolvedValue([]);
    mockSetError.mockClear();
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('seeds searchQuery from ?q= when present in the URL on mount', () => {
    vi.stubGlobal('location', {
      search: `?${QUERY_KEY}=Organic%20Chemistry`,
    });

    const { result } = renderHook(() =>
      useSearchQuery(mockBackend, mockSetError)
    );

    expect(result.current.searchQuery).toBe('Organic Chemistry');
  });

  it('falls back to sessionStorage when ?q= is absent', () => {
    vi.stubGlobal('location', { search: '' });
    sessionStorage.setItem('search-query', 'Pharmacology');

    const { result } = renderHook(() =>
      useSearchQuery(mockBackend, mockSetError)
    );

    expect(result.current.searchQuery).toBe('Pharmacology');
  });

  it('starts with an empty search box when ?q= and sessionStorage are absent', () => {
    vi.stubGlobal('location', { search: '' });

    const { result } = renderHook(() =>
      useSearchQuery(mockBackend, mockSetError)
    );

    expect(result.current.searchQuery).toBe('');
  });
});

describe('useSearchQuery which endpoint answers', () => {
  const topLevelPages = [
    notionPage('top-1', 'First shared page'),
    notionPage('top-2', 'Second shared page'),
  ];

  beforeEach(() => {
    mockBackend.search = vi.fn().mockResolvedValue([]);
    mockBackend.searchTopLevelPages = vi.fn().mockResolvedValue(topLevelPages);
    mockSetError.mockClear();
    vi.stubGlobal('location', { search: '' });
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('lists the top-level pages while the box is empty', async () => {
    const { result } = renderHook(() =>
      useSearchQuery(mockBackend, mockSetError)
    );

    await waitFor(() => expect(result.current.myPages).toEqual(topLevelPages));

    expect(mockBackend.searchTopLevelPages).toHaveBeenCalledWith('');
    expect(mockBackend.search).not.toHaveBeenCalled();
  });

  it('runs the full title search once the user types', async () => {
    const typedMatch = [notionPage('typed-1', 'Pharmacology notes')];
    mockBackend.search = vi.fn().mockResolvedValue(typedMatch);
    const { result } = renderHook(() =>
      useSearchQuery(mockBackend, mockSetError)
    );

    act(() => result.current.setSearchQuery('Pharmacology'));

    await waitFor(() => expect(result.current.myPages).toEqual(typedMatch), {
      timeout: 2000,
    });
    expect(mockBackend.search).toHaveBeenCalledWith('Pharmacology');
  });

  it('treats a box holding only spaces as empty', async () => {
    const { result } = renderHook(() =>
      useSearchQuery(mockBackend, mockSetError)
    );

    act(() => result.current.setSearchQuery('   '));

    await waitFor(
      () => expect(mockBackend.searchTopLevelPages).toHaveBeenCalledTimes(2),
      { timeout: 2000 }
    );
    expect(mockBackend.search).not.toHaveBeenCalled();
  });

  it('ignores a typed search that finishes after the box was cleared', async () => {
    vi.stubGlobal('location', { search: '?q=Pharmacology' });
    let finishTypedSearch: (pages: NotionObject[]) => void = () => {};
    mockBackend.search = vi.fn().mockReturnValue(
      new Promise<NotionObject[]>((resolve) => {
        finishTypedSearch = resolve;
      })
    );
    const { result } = renderHook(() =>
      useSearchQuery(mockBackend, mockSetError)
    );

    act(() => result.current.setSearchQuery(''));
    await waitFor(() => expect(result.current.myPages).toEqual(topLevelPages), {
      timeout: 2000,
    });
    await act(async () => {
      finishTypedSearch([notionPage('late-1', 'Stale typed result')]);
    });

    expect(result.current.myPages).toEqual(topLevelPages);
  });
});
