import { vi } from 'vitest';
import { Request, Response } from 'express';

import { UserPreferencesController } from './UserPreferencesController';
import { InMemoryUserPreferencesRepository } from '../data_layer/UserPreferencesRepository';

function buildMocks(userId = 1) {
  const repo = new InMemoryUserPreferencesRepository();
  const controller = new UserPreferencesController(repo);
  const res = {
    locals: { owner: userId },
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { repo, controller, res };
}

describe('UserPreferencesController.get', () => {
  it('returns 200 with null prefs for a fresh user', async () => {
    const { controller, res } = buildMocks(1);

    await controller.get({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      cardOptions: null,
      theme: null,
      language: null,
      ankiWebAcknowledgedAt: null,
    });
  });

  it('returns stored prefs after a patch', async () => {
    const { repo, controller, res } = buildMocks(2);
    await repo.patch(2, { theme: 'dark' });

    await controller.get({} as Request, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark' })
    );
  });
});

describe('UserPreferencesController.patch', () => {
  it('updates theme', async () => {
    const { controller, res } = buildMocks(3);
    const req = { body: { theme: 'gold' } } as unknown as Request;

    await controller.patch(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'gold' })
    );
  });

  it('updates cardOptions', async () => {
    const { controller, res } = buildMocks(4);
    const req = {
      body: { cardOptions: { deckName: 'My Deck', 'font-size': '22' } },
    } as unknown as Request;

    await controller.patch(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        cardOptions: expect.objectContaining({ deckName: 'My Deck' }),
      })
    );
  });

  it('returns 400 when cardOptions is not an object', async () => {
    const { controller, res } = buildMocks(1);
    const req = { body: { cardOptions: 'bad' } } as unknown as Request;

    await controller.patch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when theme is not a string', async () => {
    const { controller, res } = buildMocks(1);
    const req = { body: { theme: 42 } } as unknown as Request;

    await controller.patch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('updates language and round-trips it through get', async () => {
    const { repo, controller, res } = buildMocks(20);
    const req = { body: { language: 'de' } } as unknown as Request;

    await controller.patch(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'de' })
    );
    const stored = await repo.get(20);
    expect(stored.language).toBe('de');
  });

  it('accepts a BCP-47 region code for language', async () => {
    const { controller, res } = buildMocks(21);
    const req = { body: { language: 'en-US' } } as unknown as Request;

    await controller.patch(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en-US' })
    );
  });

  it('returns 400 when language is not a valid code', async () => {
    const { controller, res } = buildMocks(1);
    const req = { body: { language: 'english' } } as unknown as Request;

    await controller.patch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when language is not a string', async () => {
    const { controller, res } = buildMocks(1);
    const req = { body: { language: 42 } } as unknown as Request;

    await controller.patch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when ankiWebAcknowledgedAt is not a valid timestamp', async () => {
    const { controller, res } = buildMocks(1);
    const req = {
      body: { ankiWebAcknowledgedAt: 'not-a-date' },
    } as unknown as Request;

    await controller.patch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts a valid ISO timestamp for ankiWebAcknowledgedAt', async () => {
    const { controller, res } = buildMocks(1);
    const req = {
      body: { ankiWebAcknowledgedAt: '2026-05-13T18:00:00.000Z' },
    } as unknown as Request;

    await controller.patch(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('UserPreferencesController.deleteCardOptions', () => {
  it('returns 204 and nulls cardOptions while preserving theme and ankiWebAcknowledgedAt', async () => {
    const { repo, controller, res } = buildMocks(10);
    await repo.patch(10, { theme: 'dark', cardOptions: { deckName: 'Old' } });

    await controller.deleteCardOptions({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.json).not.toHaveBeenCalled();
    const stored = await repo.get(10);
    expect(stored.cardOptions).toBeNull();
    expect(stored.theme).toBe('dark');
  });

  it('is idempotent when cardOptions is already null', async () => {
    const { controller, res } = buildMocks(11);

    await controller.deleteCardOptions({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(204);
  });
});

describe('UserPreferencesController.migrate', () => {
  it('adopts cardOptions when DB is empty', async () => {
    const { controller, res } = buildMocks(5);
    const req = {
      body: { cardOptions: { deckName: 'Migrated', template: 'basic' } },
    } as unknown as Request;

    await controller.migrate(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        cardOptions: expect.objectContaining({ deckName: 'Migrated' }),
      })
    );
  });

  it('does not overwrite existing cardOptions', async () => {
    const { repo, controller, res } = buildMocks(6);
    await repo.patch(6, { cardOptions: { deckName: 'Existing' } });
    const req = {
      body: { cardOptions: { deckName: 'Should Not Win' } },
    } as unknown as Request;

    await controller.migrate(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        cardOptions: expect.objectContaining({ deckName: 'Existing' }),
      })
    );
  });

  it('returns 400 when cardOptions is not an object', async () => {
    const { controller, res } = buildMocks(1);
    const req = { body: { cardOptions: 123 } } as unknown as Request;

    await controller.migrate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
