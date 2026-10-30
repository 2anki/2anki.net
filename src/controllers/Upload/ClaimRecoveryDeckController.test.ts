import { vi, type Mock } from 'vitest';
import { Request, Response } from 'express';

vi.mock('../../services/events/track', () => ({ track: vi.fn() }));

import { anonRecoveryKey } from '../../lib/upload/anonymousRecovery';
import {
  ClaimRecoveryDeckUseCase,
  type RecoveryDeckStore,
} from '../../usecases/uploads/ClaimRecoveryDeckUseCase';
import { ClaimRecoveryDeckController } from './ClaimRecoveryDeckController';
import { track } from '../../services/events/track';

const trackMock = track as Mock;
const ANON = 'anon-recovery-controller';
const TOKEN = '3f2b8c1e-9a4d-4e7f-8b21-5c6d7e8f9a0b';

function buildResponse(owner = 7) {
  let status = 0;
  let json: unknown = null;
  const res = {
    locals: { owner, requestId: 'req-1' },
    status: vi.fn((code: number) => {
      status = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      json = body;
      return res;
    }),
  } as unknown as Response;
  return { res, status: () => status, json: () => json };
}

function buildRequest(
  body: unknown,
  cookies: Record<string, string> = { anon_id: ANON }
): Request {
  return { body, cookies } as unknown as Request;
}

function buildController(
  objects: Map<string, Buffer>,
  savedKey: string | null = 'owner-7-deck.apkg'
) {
  const store: RecoveryDeckStore = {
    listObjectsByPrefix: async (prefix) =>
      [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ Key: key, LastModified: new Date() })),
    getFileContents: async (key) => ({ Body: objects.get(key) }),
    delete: async (key) => objects.delete(key),
  };
  const saveRecoveredDeck = vi.fn().mockResolvedValue(savedKey);
  const controller = new ClaimRecoveryDeckController(
    new ClaimRecoveryDeckUseCase(store, { saveRecoveredDeck })
  );
  return { controller, saveRecoveredDeck };
}

function keptDeck(): Map<string, Buffer> {
  return new Map([[anonRecoveryKey(ANON, TOKEN), Buffer.from('fake-apkg')]]);
}

describe('ClaimRecoveryDeckController', () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  it('answers with the saved key and records the move', async () => {
    const { controller, saveRecoveredDeck } = buildController(keptDeck());
    const { res, status, json } = buildResponse();

    await controller.claim(
      buildRequest({ recoveryToken: TOKEN, deckName: 'Biology.apkg' }),
      res
    );

    expect(status()).toBe(200);
    expect(json()).toEqual({
      downloadKey: 'owner-7-deck.apkg',
      deckName: 'Biology.apkg',
    });
    expect(saveRecoveredDeck).toHaveBeenCalledWith(
      '7',
      'Biology.apkg',
      Buffer.from('fake-apkg'),
      'req-1'
    );
    expect(trackMock).toHaveBeenCalledWith('recovery_deck_claimed', {
      userId: 7,
      anonymousId: ANON,
    });
  });

  it('answers 404 when the second claim finds the deck already moved', async () => {
    const { controller } = buildController(keptDeck());
    const body = { recoveryToken: TOKEN, deckName: 'Biology.apkg' };

    await controller.claim(buildRequest(body), buildResponse().res);
    const second = buildResponse();
    await controller.claim(buildRequest(body), second.res);

    expect(second.status()).toBe(404);
    expect(second.json()).toEqual({ code: 'no_recovery_deck' });
  });

  it('answers 404 for a token kept under another browser’s cookie', async () => {
    const { controller, saveRecoveredDeck } = buildController(keptDeck());
    const { res, status } = buildResponse();

    await controller.claim(
      buildRequest(
        { recoveryToken: TOKEN, deckName: 'Biology.apkg' },
        { anon_id: 'another-browser' }
      ),
      res
    );

    expect(status()).toBe(404);
    expect(saveRecoveredDeck).not.toHaveBeenCalled();
  });

  it('answers 503 and keeps the deck when the account copy is not saved', async () => {
    const objects = keptDeck();
    const { controller } = buildController(objects, null);
    const { res, status } = buildResponse();

    await controller.claim(
      buildRequest({ recoveryToken: TOKEN, deckName: 'Biology.apkg' }),
      res
    );

    expect(status()).toBe(503);
    expect(objects.size).toBe(1);
  });

  it.each([
    ['a token that is not a UUID', { recoveryToken: '../x', deckName: 'a' }],
    ['no deck name', { recoveryToken: TOKEN }],
    ['an empty deck name', { recoveryToken: TOKEN, deckName: '   ' }],
    ['no body', undefined],
  ])('answers 400 for %s', async (_label, body) => {
    const { controller, saveRecoveredDeck } = buildController(keptDeck());
    const { res, status } = buildResponse();

    await controller.claim(buildRequest(body), res);

    expect(status()).toBe(400);
    expect(saveRecoveredDeck).not.toHaveBeenCalled();
  });

  it('shortens a deck name over 200 characters instead of refusing the deck', async () => {
    const { controller, saveRecoveredDeck } = buildController(keptDeck());
    const { res, status } = buildResponse();

    await controller.claim(
      buildRequest({ recoveryToken: TOKEN, deckName: 'a'.repeat(250) }),
      res
    );

    expect(status()).toBe(200);
    expect(saveRecoveredDeck).toHaveBeenCalledWith(
      '7',
      'a'.repeat(200),
      expect.any(Buffer),
      'req-1'
    );
  });

  it('never cuts an emoji in half when shortening the deck name', async () => {
    const { controller, saveRecoveredDeck } = buildController(keptDeck());

    await controller.claim(
      buildRequest({
        recoveryToken: TOKEN,
        deckName: `${'a'.repeat(199)}🧬🧬`,
      }),
      buildResponse().res
    );

    expect(saveRecoveredDeck).toHaveBeenCalledWith(
      '7',
      `${'a'.repeat(199)}🧬`,
      expect.any(Buffer),
      'req-1'
    );
  });

  it('answers 409 while another claim for the same deck is still running', async () => {
    const objects = keptDeck();
    let finishSave: (key: string) => void = () => {};
    const store: RecoveryDeckStore = {
      listObjectsByPrefix: async (prefix) =>
        [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ Key: key, LastModified: new Date() })),
      getFileContents: async (key) => ({ Body: objects.get(key) }),
      delete: async (key) => objects.delete(key),
    };
    const saveRecoveredDeck = vi.fn().mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishSave = resolve;
      })
    );
    const controller = new ClaimRecoveryDeckController(
      new ClaimRecoveryDeckUseCase(store, { saveRecoveredDeck })
    );
    const body = { recoveryToken: TOKEN, deckName: 'Biology.apkg' };

    const first = controller.claim(buildRequest(body), buildResponse().res);
    await vi.waitFor(() => expect(saveRecoveredDeck).toHaveBeenCalledTimes(1));
    const second = buildResponse();
    await controller.claim(buildRequest(body), second.res);
    finishSave('owner-7-deck.apkg');
    await first;

    expect(second.status()).toBe(409);
    expect(second.json()).toEqual({ code: 'recovery_claim_in_progress' });
  });

  it('keeps path separators out of the saved deck name', async () => {
    const { controller, saveRecoveredDeck } = buildController(keptDeck());

    await controller.claim(
      buildRequest({ recoveryToken: TOKEN, deckName: '../Bio/logy.apkg' }),
      buildResponse().res
    );

    expect(saveRecoveredDeck).toHaveBeenCalledWith(
      '7',
      '..-Bio-logy.apkg',
      expect.any(Buffer),
      'req-1'
    );
  });
});
