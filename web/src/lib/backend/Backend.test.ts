import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsId } from '../../schemas/public/Jobs';
import * as api from './api';
import { Backend } from './Backend';

// Mock the api module
vi.mock('./api', () => ({
  del: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  redirectToLogin: vi.fn(),
}));

// Helper function to create a mock Response
const createMockResponse = (
  status: number,
  ok: boolean,
  statusText = '',
  jsonData?: any
): Response => {
  const response = {
    ok,
    status,
    statusText,
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    body: null,
    bodyUsed: false,
    clone: vi.fn(),
    arrayBuffer: vi.fn(),
    blob: vi.fn(),
    formData: vi.fn(),
    json: vi.fn().mockResolvedValue(jsonData || {}),
    text: vi.fn(),
  } as unknown as Response;

  if (jsonData && status === 409) {
    (response as any).json = vi.fn().mockResolvedValue(jsonData);
  }

  return response;
};

describe('Backend', () => {
  let backend: Backend;

  beforeEach(() => {
    backend = new Backend();
    vi.clearAllMocks();
  });

  describe('deleteJob', () => {
    it('should handle successful job deletion', async () => {
      const mockResponse = createMockResponse(200, true);
      vi.mocked(api.del).mockResolvedValue(mockResponse);

      await expect(backend.deleteJob(123 as JobsId)).resolves.toBeUndefined();
      expect(api.del).toHaveBeenCalledWith('/api/upload/jobs/123');
    });

    it('should handle 409 Conflict with custom message', async () => {
      const mockResponse = createMockResponse(409, false, 'Conflict', {
        message: 'Job is currently running and cannot be deleted',
      });
      vi.mocked(api.del).mockResolvedValue(mockResponse);

      await expect(backend.deleteJob(123 as JobsId)).rejects.toThrow(
        'Job is currently running and cannot be deleted'
      );
    });

    it('should handle 409 Conflict with default message', async () => {
      const mockResponse = createMockResponse(409, false, 'Conflict');
      (mockResponse as any).json = vi
        .fn()
        .mockRejectedValue(new Error('Invalid JSON'));
      vi.mocked(api.del).mockResolvedValue(mockResponse);

      await expect(backend.deleteJob(123 as JobsId)).rejects.toThrow(
        'Cannot delete job while it is in progress'
      );
    });

    it('should handle other HTTP errors', async () => {
      const mockResponse = createMockResponse(
        500,
        false,
        'Internal Server Error'
      );
      vi.mocked(api.del).mockResolvedValue(mockResponse);

      await expect(backend.deleteJob(123 as JobsId)).rejects.toThrow(
        'Failed to delete job: 500 Internal Server Error'
      );
    });

    it('should handle null response', async () => {
      vi.mocked(api.del).mockResolvedValue(null);

      await expect(backend.deleteJob(123 as JobsId)).resolves.toBeUndefined();
    });
  });

  describe('search', () => {
    beforeEach(() => {
      vi.mocked(api.get).mockResolvedValue(
        createMockResponse(200, true, '', { results: [] })
      );
    });

    it('drops entries with empty titles and exposes parent on the rest', async () => {
      vi.mocked(api.post).mockResolvedValue(
        createMockResponse(200, true, '', {
          results: [
            {
              id: 'page-named',
              object: 'page',
              url: 'https://www.notion.so/page-named',
              parent: { type: 'page_id', page_id: 'parent-1' },
              properties: {
                title: {
                  id: 'title',
                  type: 'title',
                  title: [{ plain_text: 'Real page' }],
                },
              },
            },
            {
              id: 'page-untitled',
              object: 'page',
              url: 'https://www.notion.so/page-untitled',
              parent: { type: 'page_id', page_id: 'parent-1' },
              properties: {
                title: { id: 'title', type: 'title', title: [] },
              },
            },
            {
              id: 'db-row',
              object: 'page',
              url: 'https://www.notion.so/db-row',
              parent: { type: 'database_id', database_id: 'db-1' },
              properties: {
                Name: {
                  id: 'name',
                  type: 'title',
                  title: [{ plain_text: 'Card 1' }],
                },
              },
            },
          ],
        })
      );

      const results = await backend.search('anything');

      expect(results.map((r) => r.id)).toEqual(['page-named', 'db-row']);
      expect(results[0].parent).toEqual({ type: 'page_id' });
      expect(results[1].parent).toEqual({ type: 'database_id' });
    });
  });

  describe('restartClaudeJob', () => {
    it('should call post with the correct URL and empty payload', async () => {
      const mockResponse = createMockResponse(202, true);
      vi.mocked(api.post).mockResolvedValue(mockResponse);

      await backend.restartClaudeJob('abc-123');

      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining('upload/jobs/abc-123/restart'),
        {}
      );
    });
  });

  describe('resetUserCardOptions', () => {
    it('calls DELETE on the card-options endpoint', async () => {
      const mockResponse = createMockResponse(204, true);
      vi.mocked(api.del).mockResolvedValue(mockResponse);

      await expect(backend.resetUserCardOptions()).resolves.toBeUndefined();
      expect(api.del).toHaveBeenCalledWith(
        '/api/users/me/preferences/card-options'
      );
    });

    it('throws on non-2xx response', async () => {
      const mockResponse = createMockResponse(
        500,
        false,
        'Internal Server Error'
      );
      vi.mocked(api.del).mockResolvedValue(mockResponse);

      await expect(backend.resetUserCardOptions()).rejects.toThrow(
        'Failed to reset card options: 500'
      );
    });

    it('resolves when response is null', async () => {
      vi.mocked(api.del).mockResolvedValue(null);

      await expect(backend.resetUserCardOptions()).resolves.toBeUndefined();
    });
  });

  describe('getCheckoutPrices', () => {
    it('returns the parsed prices when the api helper resolves a v2 body', async () => {
      vi.mocked(api.get).mockResolvedValue({
        cohort: 'v2',
        legacy: false,
        monthly: { cents: 799 },
        annual: { cents: 6400 },
        lockInDeadline: null,
      });

      const prices = await backend.getCheckoutPrices();

      expect(prices).toEqual({
        cohort: 'v2',
        legacy: false,
        monthly: { cents: 799 },
        annual: { cents: 6400 },
        lockInDeadline: null,
      });
      expect(api.get).toHaveBeenCalledWith('/api/checkout/prices');
    });

    it('preserves the legacy cohort and lock-in deadline', async () => {
      vi.mocked(api.get).mockResolvedValue({
        cohort: 'legacy',
        legacy: true,
        monthly: { cents: 600 },
        annual: { cents: 6000 },
        lockInDeadline: '2026-06-21T21:59:00.000Z',
      });

      const prices = await backend.getCheckoutPrices();

      expect(prices).toEqual({
        cohort: 'legacy',
        legacy: true,
        monthly: { cents: 600 },
        annual: { cents: 6000 },
        lockInDeadline: '2026-06-21T21:59:00.000Z',
      });
    });

    it('returns null when the api helper resolves undefined', async () => {
      vi.mocked(api.get).mockResolvedValue(undefined);

      await expect(backend.getCheckoutPrices()).resolves.toBeNull();
    });

    it('returns null when required fields are missing', async () => {
      vi.mocked(api.get).mockResolvedValue({ legacy: true });

      await expect(backend.getCheckoutPrices()).resolves.toBeNull();
    });

    it('returns null when the api helper throws', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('network down'));

      await expect(backend.getCheckoutPrices()).resolves.toBeNull();
    });
  });

  describe('get()-based methods consume the parsed body', () => {
    it('listAnkifyClients returns the resolved array', async () => {
      vi.mocked(api.get).mockResolvedValue([{ id: 1 }, { id: 2 }]);

      const clients = await backend.listAnkifyClients();

      expect(clients).toEqual([{ id: 1 }, { id: 2 }]);
      expect(api.get).toHaveBeenCalledWith('/api/ankify/clients');
    });

    it('listAnkifyClients falls back to an empty array on undefined', async () => {
      vi.mocked(api.get).mockResolvedValue(undefined);

      await expect(backend.listAnkifyClients()).resolves.toEqual([]);
    });

    it('getAnkifyExportSchedule returns the resolved schedule', async () => {
      const schedule = {
        id: 7,
        owner: 42,
        database_id: 'db-1',
        time_of_day: '08:00',
        timezone: 'UTC',
        date_range_days: null,
        enabled: true,
        last_run_at: null,
      };
      vi.mocked(api.get).mockResolvedValue(schedule);

      await expect(backend.getAnkifyExportSchedule()).resolves.toEqual(
        schedule
      );
      expect(api.get).toHaveBeenCalledWith('/api/ankify/exports/schedule');
    });

    it('getAnkifyExportSchedule falls back to null on undefined', async () => {
      vi.mocked(api.get).mockResolvedValue(undefined);

      await expect(backend.getAnkifyExportSchedule()).resolves.toBeNull();
    });

    it('listAnkifySubscriptions returns the resolved array', async () => {
      const subscriptions = [
        {
          id: 1,
          notion_page_id: 'page-1',
          notion_page_title: 'Tracker',
          notion_page_url: null,
          notion_page_icon: null,
          enabled: true,
          last_polled_at: null,
          last_synced_at: null,
          last_error: null,
        },
      ];
      vi.mocked(api.get).mockResolvedValue(subscriptions);

      await expect(backend.listAnkifySubscriptions()).resolves.toEqual(
        subscriptions
      );
      expect(api.get).toHaveBeenCalledWith('/api/ankify/subscriptions');
    });

    it('listAnkifyConflicts returns the resolved array', async () => {
      const conflicts = [
        {
          id: 3,
          source_id: 'src-1',
          anki_note_id: 99,
          kind: 'content',
          notion_snapshot: { front: 'Q', back: 'A' },
          anki_snapshot: { front: 'Q', back: 'B' },
          created_at: '2026-06-11T00:00:00.000Z',
        },
      ];
      vi.mocked(api.get).mockResolvedValue(conflicts);

      await expect(backend.listAnkifyConflicts()).resolves.toEqual(conflicts);
      expect(api.get).toHaveBeenCalledWith(
        '/api/ankify/conflicts?status=pending'
      );
    });

    it('checkAnkifyActiveClientReady returns the resolved status', async () => {
      vi.mocked(api.get).mockResolvedValue({ ready: true });

      await expect(backend.checkAnkifyActiveClientReady()).resolves.toEqual({
        ready: true,
      });
      expect(api.get).toHaveBeenCalledWith('/api/ankify/clients/active/ready');
    });

    it('checkAnkifyActiveClientReady falls back to unreachable on undefined', async () => {
      vi.mocked(api.get).mockResolvedValue(undefined);

      await expect(backend.checkAnkifyActiveClientReady()).resolves.toEqual({
        ready: false,
        reason: 'unreachable',
      });
    });

    it('checkAnkifyAnkiWebStatus returns the resolved status', async () => {
      vi.mocked(api.get).mockResolvedValue({ status: 'linked' });

      await expect(backend.checkAnkifyAnkiWebStatus()).resolves.toEqual({
        status: 'linked',
      });
    });

    it('checkAnkifyAnkiWebStatus falls back to unreachable on undefined', async () => {
      vi.mocked(api.get).mockResolvedValue(undefined);

      await expect(backend.checkAnkifyAnkiWebStatus()).resolves.toEqual({
        status: 'unreachable',
      });
    });

    it('listAnkifyNotionDatabases returns the resolved array', async () => {
      const databases = [
        { id: 'db-1', title: 'Reviews', url: null, has_review_shape: true },
      ];
      vi.mocked(api.get).mockResolvedValue(databases);

      await expect(backend.listAnkifyNotionDatabases()).resolves.toEqual(
        databases
      );
      expect(api.get).toHaveBeenCalledWith('/api/ankify/notion/databases');
    });

    it('getSettings returns the payload from the resolved body', async () => {
      vi.mocked(api.get).mockResolvedValue({
        payload: { FLASHCARD: 'toggle' },
      });

      await expect(backend.getSettings('page-1')).resolves.toEqual({
        FLASHCARD: 'toggle',
      });
      expect(api.get).toHaveBeenCalledWith('/api/settings/find/page-1');
    });

    it('getSettings returns null when the body is undefined', async () => {
      vi.mocked(api.get).mockResolvedValue(undefined);

      await expect(backend.getSettings('page-1')).resolves.toBeNull();
    });

    it('listSettings returns the resolved body', async () => {
      const body = {
        items: [{ pageId: 'p1', title: 'A', updatedAt: null }],
      };
      vi.mocked(api.get).mockResolvedValue(body);

      await expect(backend.listSettings()).resolves.toEqual(body);
      expect(api.get).toHaveBeenCalledWith('/api/settings/list');
    });

    it('listSettings falls back to an empty items list on undefined', async () => {
      vi.mocked(api.get).mockResolvedValue(undefined);

      await expect(backend.listSettings()).resolves.toEqual({ items: [] });
    });
  });

  describe('favorites on an expired session', () => {
    it('addFavorite redirects to login on 401 instead of failing the toggle', async () => {
      vi.mocked(api.post).mockResolvedValue(createMockResponse(401, false));

      await expect(backend.addFavorite('page-1', 'page')).resolves.toBe(false);
      expect(api.redirectToLogin).toHaveBeenCalled();
    });

    it('deleteFavorite redirects to login on 401', async () => {
      vi.mocked(api.post).mockResolvedValue(createMockResponse(401, false));

      await expect(backend.deleteFavorite('page-1')).resolves.toBe(false);
      expect(api.redirectToLogin).toHaveBeenCalled();
    });

    it('addFavorite does not redirect on a plain failure', async () => {
      vi.mocked(api.post).mockResolvedValue(createMockResponse(500, false));

      await expect(backend.addFavorite('page-1', 'page')).resolves.toBe(false);
      expect(api.redirectToLogin).not.toHaveBeenCalled();
    });
  });

  describe('deleteRules', () => {
    it('calls DELETE on the rules endpoint with the page id', async () => {
      const mockResponse = createMockResponse(204, true);
      vi.mocked(api.del).mockResolvedValue(mockResponse);

      await expect(backend.deleteRules('page-xyz')).resolves.toBeUndefined();
      expect(api.del).toHaveBeenCalledWith('/api/rules/page-xyz');
    });

    it('throws on non-2xx response', async () => {
      const mockResponse = createMockResponse(
        500,
        false,
        'Internal Server Error'
      );
      vi.mocked(api.del).mockResolvedValue(mockResponse);

      await expect(backend.deleteRules('page-xyz')).rejects.toThrow(
        'Failed to delete rules: 500'
      );
    });
  });
});
