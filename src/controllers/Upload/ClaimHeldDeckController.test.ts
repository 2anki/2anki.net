import { Request, Response } from 'express';

jest.mock('../../services/events/track', () => ({ track: jest.fn() }));

import { InMemoryHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import {
  ClaimHeldDeckUseCase,
  type HeldDeckConverter,
  type HeldFileStore,
} from '../../usecases/uploads/ClaimHeldDeckUseCase';
import { ClaimHeldDeckController } from './ClaimHeldDeckController';
import { track } from '../../services/events/track';

const trackMock = track as jest.Mock;
const ANON = 'anon-controller-1';

function buildResponse(owner: number | null) {
  let status = 0;
  let json: unknown = null;
  let sent = false;
  const res = {
    locals: owner == null ? {} : { owner },
    status: jest.fn((code: number) => {
      status = code;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      json = body;
      return res;
    }),
    send: jest.fn(() => {
      sent = true;
      return res;
    }),
  } as unknown as Response;
  return {
    res,
    capturedStatus: () => status,
    capturedJson: () => json,
    capturedSent: () => sent,
  };
}

function buildRequest(anonId: string | null): Request {
  return {
    cookies: anonId == null ? {} : { anon_id: anonId },
  } as unknown as Request;
}

function buildUseCase(repo: InMemoryHeldDeckRepository) {
  const store: HeldFileStore = {
    getFileContents: jest
      .fn()
      .mockResolvedValue({ Body: Buffer.from('<html></html>') }),
  };
  const converter: HeldDeckConverter = {
    convertHeldFileForOwner: jest.fn().mockResolvedValue({
      downloadKey: 'owner-key.apkg',
      cardCount: 34,
      cardsHeldBack: 0,
      deckName: 'notes',
    }),
  };
  return new ClaimHeldDeckUseCase(repo, store, converter);
}

async function seedHold(repo: InMemoryHeldDeckRepository, expiresAt?: Date) {
  await repo.insert({
    claimKey: 'ck',
    storageKey: 'held/x.html',
    anonId: ANON,
    filename: 'notes.html',
    cardCount: 21,
    cardsHeldBack: 13,
    expiresAt: expiresAt ?? new Date(Date.now() + 60_000),
  });
}

describe('ClaimHeldDeckController', () => {
  beforeEach(() => trackMock.mockClear());

  it('GET returns 204 when there is no claimable hold', async () => {
    const controller = new ClaimHeldDeckController(
      buildUseCase(new InMemoryHeldDeckRepository())
    );
    const { res, capturedStatus, capturedSent } = buildResponse(7);

    await controller.check(buildRequest(ANON), res);

    expect(capturedStatus()).toBe(204);
    expect(capturedSent()).toBe(true);
  });

  it('GET returns 200 with the counts when a hold is claimable', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const controller = new ClaimHeldDeckController(buildUseCase(repo));
    const { res, capturedStatus, capturedJson } = buildResponse(7);

    await controller.check(buildRequest(ANON), res);

    expect(capturedStatus()).toBe(200);
    expect(capturedJson()).toEqual({ cardCount: 21, cardsHeldBack: 13 });
  });

  it('POST 404s when there is no hold', async () => {
    const controller = new ClaimHeldDeckController(
      buildUseCase(new InMemoryHeldDeckRepository())
    );
    const { res, capturedStatus } = buildResponse(7);

    await controller.claim(buildRequest(ANON), res);

    expect(capturedStatus()).toBe(404);
    expect(trackMock).not.toHaveBeenCalled();
  });

  it('POST 410s when the hold has expired', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo, new Date(Date.now() - 60_000));
    const controller = new ClaimHeldDeckController(buildUseCase(repo));
    const { res, capturedStatus } = buildResponse(7);

    await controller.claim(buildRequest(ANON), res);

    expect(capturedStatus()).toBe(410);
  });

  it('POST 200s with the download key and fires anonymous_partial_claimed', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const controller = new ClaimHeldDeckController(buildUseCase(repo));
    const { res, capturedStatus, capturedJson } = buildResponse(7);

    await controller.claim(buildRequest(ANON), res);

    expect(capturedStatus()).toBe(200);
    expect(capturedJson()).toEqual({ downloadKey: 'owner-key.apkg' });
    expect(trackMock).toHaveBeenCalledWith('anonymous_partial_claimed', {
      userId: 7,
      anonymousId: ANON,
      props: { arm: 'treatment' },
    });
  });

  it('POST 410s on the second claim once the hold is claimed', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const controller = new ClaimHeldDeckController(buildUseCase(repo));

    const first = buildResponse(7);
    await controller.claim(buildRequest(ANON), first.res);
    expect(first.capturedStatus()).toBe(200);

    const second = buildResponse(7);
    await controller.claim(buildRequest(ANON), second.res);
    expect(second.capturedStatus()).toBe(410);
  });
});
