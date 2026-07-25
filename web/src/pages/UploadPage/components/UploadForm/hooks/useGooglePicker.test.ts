import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGooglePicker } from './useGooglePicker';

const ORIGINAL_CLIENT = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const ORIGINAL_API_KEY = process.env.REACT_APP_GOOGLE_API_KEY;

type GoogleGlobal = {
  picker?: unknown;
  accounts?: { oauth2?: unknown };
};

afterEach(() => {
  process.env.REACT_APP_GOOGLE_CLIENT_ID = ORIGINAL_CLIENT;
  process.env.REACT_APP_GOOGLE_API_KEY = ORIGINAL_API_KEY;
  delete (window as unknown as { gapi?: unknown }).gapi;
  delete (window as unknown as { google?: GoogleGlobal }).google;
  document.querySelectorAll('script#gapi-js').forEach((n) => n.remove());
  document.querySelectorAll('script#gis-js').forEach((n) => n.remove());
});

function buildBuilder(
  onCallback: (cb: (data: { action: string; docs?: unknown[] }) => void) => void
) {
  const built = { setVisible: vi.fn() };
  const builder: Record<string, unknown> = {};
  builder.setAppId = vi.fn().mockReturnValue(builder);
  builder.setOAuthToken = vi.fn().mockReturnValue(builder);
  builder.setDeveloperKey = vi.fn().mockReturnValue(builder);
  builder.addView = vi.fn().mockReturnValue(builder);
  builder.setCallback = vi
    .fn()
    .mockImplementation(
      (
        cb: typeof onCallback extends never
          ? never
          : (data: { action: string; docs?: unknown[] }) => void
      ) => {
        onCallback(cb);
        return builder;
      }
    );
  builder.build = vi.fn().mockReturnValue(built);
  return { builder, built };
}

function stubGoogle(
  pickerCallbackRunner: (
    cb: (data: { action: string; docs?: unknown[] }) => void
  ) => void,
  tokenResponse: { access_token?: string; error?: string } = {
    access_token: 'test-token',
  }
) {
  const { builder, built } = buildBuilder(pickerCallbackRunner);

  (window as unknown as { gapi: unknown }).gapi = {
    load: (_lib: string, cb: () => void) => cb(),
  };

  const docsViewInstance = { setIncludeFolders: vi.fn().mockReturnThis() };

  (window as unknown as { google: GoogleGlobal }).google = {
    picker: {
      PickerBuilder: function PickerBuilder() {
        return builder;
      },
      ViewId: { DOCS: 'DOCS' },
      Action: { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' },
      DocsView: function DocsView() {
        return docsViewInstance;
      },
    },
    accounts: {
      oauth2: {
        initTokenClient: ({
          callback,
        }: {
          callback: (resp: { access_token?: string; error?: string }) => void;
        }) => ({
          callback,
          requestAccessToken: () => callback(tokenResponse),
        }),
      },
    },
  };

  return { builder, built };
}

describe('useGooglePicker', () => {
  it('reports not configured when env vars are missing', () => {
    process.env.REACT_APP_GOOGLE_CLIENT_ID = '';
    process.env.REACT_APP_GOOGLE_API_KEY = '';
    const { result } = renderHook(() => useGooglePicker());
    expect(result.current.isConfigured).toBe(false);
  });

  it('rejects openPicker when env vars are missing', async () => {
    process.env.REACT_APP_GOOGLE_CLIENT_ID = '';
    process.env.REACT_APP_GOOGLE_API_KEY = '';
    const { result } = renderHook(() => useGooglePicker());
    await expect(result.current.openPicker()).rejects.toThrow(
      /Couldn't load Google Drive/
    );
  });

  describe('with credentials configured', () => {
    beforeEach(() => {
      process.env.REACT_APP_GOOGLE_CLIENT_ID = 'test-client-id';
      process.env.REACT_APP_GOOGLE_API_KEY = 'AIza' + 'fake-test-key';
    });

    it('resolves with picked files and the access token when the user picks a file', async () => {
      stubGoogle((cb) => {
        queueMicrotask(() =>
          cb({
            action: 'picked',
            docs: [
              {
                id: 'abc123',
                name: 'biology.pdf',
                mimeType: 'application/pdf',
                iconUrl:
                  'https://drive-thirdparty.googleusercontent.com/16/type/pdf',
                url: 'https://drive.google.com/file/d/abc123/view',
                sizeBytes: 2457600,
              },
            ],
          })
        );
      });
      const { result } = renderHook(() => useGooglePicker());
      const outcome = await result.current.openPicker();
      expect(outcome.kind).toBe('picked');
      if (outcome.kind !== 'picked') return;
      expect(outcome.accessToken).toBe('test-token');
      expect(outcome.files).toHaveLength(1);
      expect(outcome.files[0]).toMatchObject({
        id: 'abc123',
        name: 'biology.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2457600,
      });
    });

    it('resolves cancelled when the user dismisses the picker', async () => {
      stubGoogle((cb) => {
        queueMicrotask(() => cb({ action: 'cancel' }));
      });
      const { result } = renderHook(() => useGooglePicker());
      const outcome = await result.current.openPicker();
      expect(outcome).toEqual({ kind: 'cancelled' });
    });

    it('rejects when the token request returns an error', async () => {
      stubGoogle(() => undefined, { error: 'access_denied' });
      const { result } = renderHook(() => useGooglePicker());
      await expect(result.current.openPicker()).rejects.toThrow(
        /access_denied/
      );
    });

    it('times out and clears the in-flight guard when the auth callback never fires (blocked or closed pop-up)', async () => {
      vi.useFakeTimers();
      try {
        (window as unknown as { gapi: unknown }).gapi = {
          load: (_lib: string, cb: () => void) => cb(),
        };
        (window as unknown as { google: GoogleGlobal }).google = {
          picker: {
            PickerBuilder: function PickerBuilder() {
              return buildBuilder(() => undefined).builder;
            },
            ViewId: { DOCS: 'DOCS' },
            Action: { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' },
            DocsView: function DocsView() {
              return { setIncludeFolders: vi.fn().mockReturnThis() };
            },
          },
          accounts: {
            oauth2: {
              initTokenClient: () => ({
                callback: () => undefined,
                requestAccessToken: () => undefined,
              }),
            },
          },
        };

        const { result } = renderHook(() => useGooglePicker());
        const pending = result.current.openPicker().catch((e) => e);

        await vi.advanceTimersByTimeAsync(60_000);
        const err = await pending;

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/pop-up/i);

        // The guard must have reset — a fresh call should not immediately
        // reject with "already open"; it should be freshly pending instead.
        let secondSettled = false;
        let secondError: unknown;
        result.current.openPicker().then(
          () => {
            secondSettled = true;
          },
          (e) => {
            secondSettled = true;
            secondError = e;
          }
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(secondSettled).toBe(false);
        expect(secondError).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('calls setAppId with the project number derived from the client id', async () => {
      process.env.REACT_APP_GOOGLE_CLIENT_ID =
        '806855830059-abc123def.apps.googleusercontent.com';
      const { builder } = stubGoogle((cb) => {
        queueMicrotask(() => cb({ action: 'cancel' }));
      });
      const { result } = renderHook(() => useGooglePicker());
      await result.current.openPicker();
      expect(builder.setAppId).toHaveBeenCalledWith('806855830059');
    });
  });
});
