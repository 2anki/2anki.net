import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { useHandleLoginSubmit } from './useHandleLoginSubmit';

const mockLogin = vi.fn();

vi.mock('../../../../../lib/backend/get2ankiApi', () => ({
  get2ankiApi: () => ({
    login: mockLogin,
  }),
}));

vi.mock('../../../../../lib/data_layer/userPreferencesSync', () => ({
  migrateToServer: vi.fn().mockResolvedValue(undefined),
  hydrateFromServer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('react-cookie', () => ({
  useCookies: () => [undefined, vi.fn()],
}));

const originalLocation = globalThis.location;

function setSearchParams(search: string) {
  Object.defineProperty(globalThis, 'location', {
    value: { ...originalLocation, search, href: '' },
    writable: true,
    configurable: true,
  });
}

const fakeSubmitEvent = {
  preventDefault: vi.fn(),
  currentTarget: document.createElement('form'),
} as unknown as React.FormEvent<HTMLFormElement>;

beforeEach(() => {
  mockLogin.mockReset();
  Object.defineProperty(globalThis, 'location', {
    value: { search: '', href: '' },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'location', {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
});

describe('useHandleLoginSubmit redirect behavior', () => {
  it('uses server redirect when no URL ?redirect= param', async () => {
    mockLogin.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ token: 'tok', redirect: '/notion' }),
    });

    const { result } = renderHook(() => useHandleLoginSubmit(vi.fn()));

    await act(async () => {
      await result.current.onSubmit(fakeSubmitEvent);
    });

    expect(globalThis.location.href).toBe('/notion');
  });

  it('uses URL ?redirect= as fallback when server response has no redirect', async () => {
    setSearchParams('?redirect=%2Fcard-options');
    mockLogin.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ token: 'tok' }),
    });

    const { result } = renderHook(() => useHandleLoginSubmit(vi.fn()));

    await act(async () => {
      await result.current.onSubmit(fakeSubmitEvent);
    });

    expect(globalThis.location.href).toBe('/card-options');
  });

  it('lands on the unfiltered search page when nothing names a redirect', async () => {
    mockLogin.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ token: 'tok' }),
    });

    const { result } = renderHook(() => useHandleLoginSubmit(vi.fn()));

    await act(async () => {
      await result.current.onSubmit(fakeSubmitEvent);
    });

    expect(globalThis.location.href).toBe('/search');
  });

  it('prefers server redirect over URL ?redirect= when server provides one', async () => {
    setSearchParams('?redirect=%2Fcard-options');
    mockLogin.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ token: 'tok', redirect: '/notion' }),
    });

    const { result } = renderHook(() => useHandleLoginSubmit(vi.fn()));

    await act(async () => {
      await result.current.onSubmit(fakeSubmitEvent);
    });

    expect(globalThis.location.href).toBe('/notion');
  });

  it('rejects open-redirect attempts from URL ?redirect= param', async () => {
    setSearchParams('?redirect=%2F%2Fevil.com');
    mockLogin.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ token: 'tok' }),
    });

    const { result } = renderHook(() => useHandleLoginSubmit(vi.fn()));

    await act(async () => {
      await result.current.onSubmit(fakeSubmitEvent);
    });

    expect(globalThis.location.href).not.toBe('//evil.com');
  });

  it('rejects javascript: scheme in URL ?redirect= param', async () => {
    setSearchParams('?redirect=javascript%3Aalert(1)');
    mockLogin.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ token: 'tok' }),
    });

    const { result } = renderHook(() => useHandleLoginSubmit(vi.fn()));

    await act(async () => {
      await result.current.onSubmit(fakeSubmitEvent);
    });

    expect(globalThis.location.href).not.toContain('javascript:');
  });
});
