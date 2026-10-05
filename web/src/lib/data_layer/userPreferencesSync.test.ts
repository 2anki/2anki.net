// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acknowledgeAnkiWeb,
  cancelPendingSync,
  fetchUserPreferences,
  hydrateFromServer,
  migrateToServer,
  scheduleSync,
} from './userPreferencesSync';
import i18n from '../i18n';

const setCookie = (value: string) => {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => value,
  });
};

const flushDebounce = async () => {
  vi.advanceTimersByTime(600);
  await Promise.resolve();
  await Promise.resolve();
};

describe('userPreferencesSync — anonymous user (no token cookie)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    setCookie('');
    localStorage.clear();
    localStorage.setItem('2anki-theme', 'dark');
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    cancelPendingSync();
    fetchSpy.mockRestore();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('scheduleSync does not call the preferences endpoint', async () => {
    scheduleSync();
    await flushDebounce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetchUserPreferences returns null without calling fetch', async () => {
    const result = await fetchUserPreferences();
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hydrateFromServer is a no-op', async () => {
    await hydrateFromServer();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('migrateToServer is a no-op', async () => {
    await migrateToServer();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('acknowledgeAnkiWeb still writes localStorage but does not call fetch', async () => {
    await acknowledgeAnkiWeb();
    expect(localStorage.getItem('ankify_anki_web_acknowledged')).toBe('true');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('userPreferencesSync — authenticated user (token cookie present)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    setCookie('token=abc123; other=value');
    localStorage.clear();
    localStorage.setItem('2anki-theme', 'dark');
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    cancelPendingSync();
    fetchSpy.mockRestore();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('scheduleSync PATCHes the preferences endpoint after the debounce window', async () => {
    scheduleSync();
    await flushDebounce();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/users/me/preferences',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('scheduleSync collects boolean toggle keys saved as defaults', async () => {
    localStorage.setItem('basic-reversed', 'true');
    localStorage.setItem('download-pdfs', 'true');
    localStorage.setItem('field-mapping', '{"front":"Term"}');

    scheduleSync();
    await flushDebounce();

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as { body: string }).body
    );
    expect(body.cardOptions).toMatchObject({
      'basic-reversed': 'true',
      'download-pdfs': 'true',
      'field-mapping': '{"front":"Term"}',
    });
  });

  it('scheduleSync includes the stored language in the PATCH body', async () => {
    localStorage.setItem('2anki-language', 'de');

    scheduleSync();
    await flushDebounce();

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as { body: string }).body
    );
    expect(body.language).toBe('de');
  });
});

describe('userPreferencesSync — hydrate (authenticated)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setCookie('token=abc123');
    localStorage.clear();
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    localStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('writes boolean toggle keys from the server back to localStorage', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          cardOptions: { 'basic-reversed': 'true', cherry: 'true' },
          theme: null,
          ankiWebAcknowledgedAt: null,
        }),
        { status: 200 }
      )
    );

    await hydrateFromServer();

    expect(localStorage.getItem('basic-reversed')).toBe('true');
    expect(localStorage.getItem('cherry')).toBe('true');
  });

  it('applies a server language to i18n and localStorage', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          cardOptions: null,
          theme: null,
          language: 'de',
          ankiWebAcknowledgedAt: null,
        }),
        { status: 200 }
      )
    );

    await hydrateFromServer();

    expect(localStorage.getItem('2anki-language')).toBe('de');
    await vi.waitFor(() => expect(i18n.resolvedLanguage).toBe('de'));
  });
});
