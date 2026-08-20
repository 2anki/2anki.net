import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDeckShare,
  getActiveSharesForUploadKey,
  getSharedDeckBatch,
  getSharedDeckMeta,
  revokeDeckShare,
} from './getSharedDeck';

function jsonResponse(
  status: number,
  body: unknown,
  statusText = ''
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getSharedDeck', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('getSharedDeckMeta', () => {
    it('encodes the token in the URL and returns the parsed body', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse(200, { deck_name: 'Biochem', card_count: 12 })
      );

      const meta = await getSharedDeckMeta('tok en/with spaces');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/shares/tok%20en%2Fwith%20spaces/meta'
      );
      expect(meta).toEqual({ deck_name: 'Biochem', card_count: 12 });
    });

    it('throws the server message on a JSON error body', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse(404, { message: 'Share not found' }, 'Not Found')
      );

      await expect(getSharedDeckMeta('t')).rejects.toThrow('Share not found');
    });

    it('falls back to method, path, and status when no JSON message is present', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 500, statusText: 'Internal Server Error' })
      );

      await expect(getSharedDeckMeta('t')).rejects.toThrow(
        'HTTP error! GET /api/shares/t/meta status: 500, message: Internal Server Error'
      );
    });
  });

  describe('getSharedDeckBatch', () => {
    it('omits cursor when null, includes page_size, and includes deck_id when set', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse(200, { cards: [], next_cursor: null })
      );

      await getSharedDeckBatch('tok', null, { pageSize: 25, deckId: 42 });

      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain('/api/shares/tok/cards?');
      expect(url).toContain('page_size=25');
      expect(url).toContain('deck_id=42');
      expect(url).not.toContain('cursor=');
    });

    it('includes cursor when provided and omits deck_id when null', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse(200, { cards: [], next_cursor: null })
      );

      await getSharedDeckBatch('tok', 10);

      const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
      expect(url).toContain('cursor=10');
      expect(url).toContain('page_size=20');
      expect(url).not.toContain('deck_id=');
    });
  });

  describe('createDeckShare', () => {
    it('POSTs the upload_key and returns the new share', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse(201, { token: 'abc', url: 'https://2anki.net/s/abc' })
      );

      const share = await createDeckShare('uploads/123.apkg');

      expect(share).toEqual({ token: 'abc', url: 'https://2anki.net/s/abc' });
      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(url).toBe('/api/shares');
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ upload_key: 'uploads/123.apkg' }),
      });
    });

    it('throws the server message on a JSON error body', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        jsonResponse(403, { message: 'Upload not owned by you' }, 'Forbidden')
      );

      await expect(createDeckShare('uploads/x.apkg')).rejects.toThrow(
        'Upload not owned by you'
      );
    });

    it('falls back to method, path, and status when no JSON message is present', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 500, statusText: 'Internal Server Error' })
      );

      await expect(createDeckShare('uploads/x.apkg')).rejects.toThrow(
        'HTTP error! POST /api/shares status: 500, message: Internal Server Error'
      );
    });
  });

  describe('revokeDeckShare', () => {
    it('DELETEs the share by encoded token', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(null, { status: 204 })
      );

      await revokeDeckShare('tok/with/slash');

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(url).toBe('/api/shares/tok%2Fwith%2Fslash');
      expect(init).toMatchObject({ method: 'DELETE', credentials: 'include' });
    });

    it('treats 404 as already revoked and resolves', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 404 })
      );

      await expect(revokeDeckShare('tok')).resolves.toBeUndefined();
    });

    it('throws when the server returns a non-404 error', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 500 })
      );

      await expect(revokeDeckShare('tok')).rejects.toThrow(
        'Failed to stop sharing.'
      );
    });
  });

  describe('getActiveSharesForUploadKey', () => {
    it('returns the matching share when one exists', async () => {
      const shares = [
        {
          token: 't1',
          upload_key: 'uploads/a.apkg',
          url: 'https://2anki.net/s/t1',
          created_at: '2026-05-20T00:00:00Z',
          view_count: 0,
        },
        {
          token: 't2',
          upload_key: 'uploads/b.apkg',
          url: 'https://2anki.net/s/t2',
          created_at: '2026-05-20T00:00:00Z',
          view_count: 7,
        },
      ];
      vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(200, shares));

      const match = await getActiveSharesForUploadKey('uploads/b.apkg');

      expect(match?.token).toBe('t2');
    });

    it('returns null when no share matches the key', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(200, []));

      await expect(
        getActiveSharesForUploadKey('uploads/x.apkg')
      ).resolves.toBeNull();
    });

    it('returns null when the request fails', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 401 })
      );

      await expect(
        getActiveSharesForUploadKey('uploads/x.apkg')
      ).resolves.toBeNull();
    });
  });
});
