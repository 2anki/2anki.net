// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDropboxChooser } from './useDropboxChooser';

const ORIGINAL_KEY = process.env.REACT_APP_DROPBOX_APP_KEY;

afterEach(() => {
  process.env.REACT_APP_DROPBOX_APP_KEY = ORIGINAL_KEY;
  delete (window as unknown as { Dropbox?: unknown }).Dropbox;
  document
    .querySelectorAll('script#dropboxjs')
    .forEach((node) => node.remove());
});

describe('useDropboxChooser', () => {
  it('reports not configured when the app key is missing', () => {
    process.env.REACT_APP_DROPBOX_APP_KEY = '';
    const { result } = renderHook(() => useDropboxChooser(['.pdf']));
    expect(result.current.isConfigured).toBe(false);
  });

  it('rejects openChooser when the app key is missing', async () => {
    process.env.REACT_APP_DROPBOX_APP_KEY = '';
    const { result } = renderHook(() => useDropboxChooser(['.pdf']));
    await expect(result.current.openChooser()).rejects.toThrow(
      /Couldn't load Dropbox/
    );
  });

  describe('with a configured app key', () => {
    beforeEach(() => {
      process.env.REACT_APP_DROPBOX_APP_KEY = 'test-key';
    });

    it('resolves with picked files when the user chooses a file', async () => {
      (window as unknown as { Dropbox?: unknown }).Dropbox = {
        choose: ({ success }: { success: (files: unknown[]) => void }) => {
          success([
            {
              id: 'id:1',
              name: 'pharm.pdf',
              bytes: 200,
              icon: 'page_white_acrobat',
              isDir: false,
              link: 'https://dl.dropboxusercontent.com/x/pharm.pdf',
              linkType: 'direct',
            },
          ]);
        },
      };
      const { result } = renderHook(() => useDropboxChooser(['.pdf']));
      let outcome: unknown;
      await act(async () => {
        outcome = await result.current.openChooser();
      });
      expect(outcome).toEqual({
        kind: 'picked',
        files: [
          expect.objectContaining({ name: 'pharm.pdf', linkType: 'direct' }),
        ],
      });
    });

    it('resolves with cancelled when the user closes the chooser', async () => {
      (window as unknown as { Dropbox?: unknown }).Dropbox = {
        choose: ({ cancel }: { cancel?: () => void }) => cancel?.(),
      };
      const { result } = renderHook(() => useDropboxChooser(['.pdf']));
      let outcome: unknown;
      await act(async () => {
        outcome = await result.current.openChooser();
      });
      expect(outcome).toEqual({ kind: 'cancelled' });
    });

    it('rejects when the SDK script fails to load', async () => {
      const appendChildSpy = vi
        .spyOn(document.head, 'appendChild')
        .mockImplementation((node) => {
          if ((node as HTMLScriptElement).id === 'dropboxjs') {
            queueMicrotask(() => node.dispatchEvent(new Event('error')));
          }
          return node as unknown as Node;
        });
      const { result } = renderHook(() => useDropboxChooser(['.pdf']));
      await expect(result.current.openChooser()).rejects.toThrow(
        /Couldn't load Dropbox/
      );
      appendChildSpy.mockRestore();
    });
  });
});
