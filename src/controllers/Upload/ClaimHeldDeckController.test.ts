import { vi, type Mock } from 'vitest';
import { Request, Response } from 'express';

vi.mock('../../services/events/track', () => ({ track: vi.fn() }));

import { InMemoryHeldDeckRepository } from '../../data_layer/HeldDeckRepository';
import {
  ClaimHeldDeckUseCase,
  planHoldKey,
  type HeldDeckConverter,
  type HeldFileStore,
} from '../../usecases/uploads/ClaimHeldDeckUseCase';
import { MonthlyLimitError } from '../../usecases/users/CheckMonthlyCardLimitUseCase';
import { EmptyDeckError } from '../../usecases/jobs/EmptyDeckError';
import { ClaimHeldDeckController } from './ClaimHeldDeckController';
import { track } from '../../services/events/track';
import {
  __resetFeatureFlagModuleForTests,
  __setFeatureFlagDependencies,
} from '../../lib/featureFlags/getFeatureFlag';
import { ANONYMOUS_PREVIEW_CARDS_FLAG } from '../../lib/upload/anonymousPreviewCards';
import { LIMIT_WALL_PASS_FIRST_FLAG } from '../../lib/featureFlags/limitWallPassFirst';

const trackMock = track as Mock;
const ANON = 'anon-controller-1';

function previewCardsFlag(on: boolean, passFirst = false) {
  __setFeatureFlagDependencies({
    repository: {
      getAll: () => Promise.resolve([]),
      get: (key: string) => {
        if (key === ANONYMOUS_PREVIEW_CARDS_FLAG) return Promise.resolve(on);
        if (key === LIMIT_WALL_PASS_FIRST_FLAG) {
          return Promise.resolve(passFirst);
        }
        return Promise.resolve(null);
      },
      set: () => Promise.resolve(null),
    },
  });
}

function buildResponse(owner: number | null) {
  let status = 0;
  let json: unknown = null;
  let sent = false;
  const res = {
    locals: owner == null ? {} : { owner },
    status: vi.fn((code: number) => {
      status = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      json = body;
      return res;
    }),
    send: vi.fn(() => {
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

function buildRequest(
  anonId: string | null,
  consent: 'granted' | 'denied' = 'granted'
): Request {
  return {
    cookies:
      anonId == null
        ? { cookie_consent: consent }
        : { anon_id: anonId, cookie_consent: consent },
  } as unknown as Request;
}

function rebuiltWorkerCrash(): Error {
  const error = Object.assign(
    new Error("Cannot read properties of undefined (reading '0')"),
    { name: 'TypeError' }
  );
  error.stack =
    "TypeError: Cannot read properties of undefined (reading '0')\n" +
    '    at firstCell (/app/src/lib/parser/tables.ts:12:3)';
  return error;
}

function buildUseCase(repo: InMemoryHeldDeckRepository) {
  const store: HeldFileStore = {
    getFileContents: vi
      .fn()
      .mockResolvedValue({ Body: Buffer.from('<html></html>') }),
  };
  const converter: HeldDeckConverter = {
    convertHeldFileForOwner: vi.fn().mockResolvedValue({
      downloadKey: 'owner-key.apkg',
      cardCount: 34,
      cardsHeldBack: 0,
      deckName: 'notes',
    }),
  };
  return new ClaimHeldDeckUseCase(repo, store, converter);
}

async function seedHold(
  repo: InMemoryHeldDeckRepository,
  expiresAt?: Date,
  anonId = ANON
) {
  await repo.insert({
    storageKey: 'held/x.html',
    anonId,
    filename: 'notes.html',
    cardCount: 21,
    cardsHeldBack: 13,
    expiresAt: expiresAt ?? new Date(Date.now() + 60_000),
  });
}

describe('ClaimHeldDeckController', () => {
  beforeEach(() => {
    trackMock.mockClear();
    previewCardsFlag(false);
  });

  afterEach(() => __resetFeatureFlagModuleForTests());

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

  it('POST rethrows a worker crash unchanged, so the app error handler answers it', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const crash = rebuiltWorkerCrash();
    const store: HeldFileStore = {
      getFileContents: vi
        .fn()
        .mockResolvedValue({ Body: Buffer.from('<html></html>') }),
    };
    const converter: HeldDeckConverter = {
      convertHeldFileForOwner: vi.fn().mockRejectedValue(crash),
    };
    const controller = new ClaimHeldDeckController(
      new ClaimHeldDeckUseCase(repo, store, converter)
    );
    const { res } = buildResponse(7);

    await expect(controller.claim(buildRequest(ANON), res)).rejects.toBe(crash);
    expect(res.json).not.toHaveBeenCalled();
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

  it('POST returns the held-back count when a sign-up claim is cut to the preview', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const converter: HeldDeckConverter = {
      convertHeldFileForOwner: vi.fn().mockResolvedValue({
        downloadKey: 'owner-key.apkg',
        cardCount: 21,
        cardsHeldBack: 13,
        deckName: 'notes',
        heldForPlan: true,
      }),
    };
    const store: HeldFileStore = {
      getFileContents: vi
        .fn()
        .mockResolvedValue({ Body: Buffer.from('<html></html>') }),
    };
    const controller = new ClaimHeldDeckController(
      new ClaimHeldDeckUseCase(repo, store, converter, async () => true)
    );
    const { res, capturedStatus, capturedJson } = buildResponse(7);

    await controller.claim(buildRequest(ANON), res);

    expect(capturedStatus()).toBe(200);
    expect(capturedJson()).toEqual({
      downloadKey: 'owner-key.apkg',
      cardCount: 21,
      deckName: 'notes',
      kind: 'signup',
      cardsHeldBack: 13,
      heldForPlan: true,
      cutAt: 'preview',
    });
  });

  it('POST returns the held-back count when a sign-up claim is cut at the free month', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const converter: HeldDeckConverter = {
      convertHeldFileForOwner: vi.fn().mockResolvedValue({
        downloadKey: 'owner-key.apkg',
        cardCount: 10,
        cardsHeldBack: 24,
        deckName: 'notes',
        heldForPlan: true,
      }),
    };
    const store: HeldFileStore = {
      getFileContents: vi
        .fn()
        .mockResolvedValue({ Body: Buffer.from('<html></html>') }),
    };
    const controller = new ClaimHeldDeckController(
      new ClaimHeldDeckUseCase(repo, store, converter, async () => false)
    );
    const { res, capturedStatus, capturedJson } = buildResponse(7);

    await controller.claim(buildRequest(ANON), res);

    expect(capturedStatus()).toBe(200);
    expect(capturedJson()).toEqual({
      downloadKey: 'owner-key.apkg',
      cardCount: 10,
      deckName: 'notes',
      kind: 'signup',
      cardsHeldBack: 24,
      heldForPlan: true,
      cutAt: 'month',
    });
  });

  it.each([
    ['cut to the preview', true],
    ['cut to the free month', false],
  ])(
    'POST says how many answerless lines a sign-up claim %s left out',
    async (_case, previewFirst) => {
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo);
      const converter: HeldDeckConverter = {
        convertHeldFileForOwner: vi.fn().mockResolvedValue({
          downloadKey: 'owner-key.apkg',
          cardCount: 21,
          cardsHeldBack: 0,
          cardsLeftOut: 6,
          deckName: 'notes',
          heldForPlan: false,
        }),
      };
      const store: HeldFileStore = {
        getFileContents: vi
          .fn()
          .mockResolvedValue({ Body: Buffer.from('<html></html>') }),
      };
      const controller = new ClaimHeldDeckController(
        new ClaimHeldDeckUseCase(
          repo,
          store,
          converter,
          async () => previewFirst
        )
      );
      const { res, capturedStatus, capturedJson } = buildResponse(7);

      await controller.claim(buildRequest(ANON), res);

      expect(capturedStatus()).toBe(200);
      expect(capturedJson()).toMatchObject({ cardCount: 21, cardsLeftOut: 6 });
    }
  );

  it('POST 200s with the download key and fires anonymous_partial_claimed', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const controller = new ClaimHeldDeckController(buildUseCase(repo));
    const { res, capturedStatus, capturedJson } = buildResponse(7);

    await controller.claim(buildRequest(ANON), res);

    expect(capturedStatus()).toBe(200);
    expect(capturedJson()).toEqual({
      downloadKey: 'owner-key.apkg',
      cardCount: 34,
      deckName: 'notes',
      kind: 'signup',
    });
    expect(trackMock).toHaveBeenCalledWith('anonymous_partial_claimed', {
      userId: 7,
      anonymousId: ANON,
      props: { arm: 'treatment', preview_cards_arm: 'off' },
    });
  });

  it('records the claim outside the test while the pass-first wall is on', async () => {
    previewCardsFlag(true, true);
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo, undefined, 'anon-preview-1');
    const controller = new ClaimHeldDeckController(buildUseCase(repo));
    const { res } = buildResponse(7);

    await controller.claim(buildRequest('anon-preview-1'), res);

    expect(trackMock).toHaveBeenCalledWith('anonymous_partial_claimed', {
      userId: 7,
      anonymousId: 'anon-preview-1',
      props: { arm: 'treatment', preview_cards_arm: 'off' },
    });
  });

  it.each([
    ['anon-preview-1', 'treatment'],
    ['anon-preview-0', 'control'],
  ])(
    'records the preview cards arm worked out for %s at claim time',
    async (anonId, previewArm) => {
      previewCardsFlag(true);
      const repo = new InMemoryHeldDeckRepository();
      await seedHold(repo, undefined, anonId);
      const controller = new ClaimHeldDeckController(buildUseCase(repo));
      const { res, capturedStatus } = buildResponse(7);

      await controller.claim(buildRequest(anonId), res);

      expect(capturedStatus()).toBe(200);
      expect(trackMock).toHaveBeenCalledWith('anonymous_partial_claimed', {
        userId: 7,
        anonymousId: anonId,
        props: { arm: 'treatment', preview_cards_arm: previewArm },
      });
    }
  );

  it('claims the hold for a visitor who declined analytics, keeping the arm but not the anonymous id on the event', async () => {
    previewCardsFlag(true);
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo, undefined, 'anon-preview-1');
    const controller = new ClaimHeldDeckController(buildUseCase(repo));
    const { res, capturedStatus, capturedJson } = buildResponse(7);

    await controller.claim(buildRequest('anon-preview-1', 'denied'), res);

    expect(capturedStatus()).toBe(200);
    expect(capturedJson()).toMatchObject({
      downloadKey: 'owner-key.apkg',
      kind: 'signup',
    });
    expect(trackMock).toHaveBeenCalledWith('anonymous_partial_claimed', {
      userId: 7,
      anonymousId: null,
      props: { arm: 'treatment', preview_cards_arm: 'treatment' },
    });
  });

  it('POST 409s with monthly_limit when the account cannot take the deck this month', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const store: HeldFileStore = {
      getFileContents: vi
        .fn()
        .mockResolvedValue({ Body: Buffer.from('<html></html>') }),
    };
    const converter: HeldDeckConverter = {
      convertHeldFileForOwner: vi
        .fn()
        .mockRejectedValue(new MonthlyLimitError(100, 100, 21, '2026-10-01')),
    };
    const controller = new ClaimHeldDeckController(
      new ClaimHeldDeckUseCase(repo, store, converter)
    );
    const { res, capturedStatus, capturedJson } = buildResponse(7);

    await controller.claim(buildRequest(ANON), res);

    expect(capturedStatus()).toBe(409);
    expect(capturedJson()).toEqual({ code: 'monthly_limit' });
    expect(trackMock).not.toHaveBeenCalledWith(
      'anonymous_partial_claimed',
      expect.anything()
    );
  });

  it('POST 400s with empty_export and the reason when the owner conversion has no cards', async () => {
    const repo = new InMemoryHeldDeckRepository();
    await seedHold(repo);
    const store: HeldFileStore = {
      getFileContents: vi
        .fn()
        .mockResolvedValue({ Body: Buffer.from('<html></html>') }),
    };
    const converter: HeldDeckConverter = {
      convertHeldFileForOwner: vi
        .fn()
        .mockRejectedValue(new EmptyDeckError(undefined, 'all_filtered')),
    };
    const controller = new ClaimHeldDeckController(
      new ClaimHeldDeckUseCase(repo, store, converter)
    );
    const { res, capturedStatus, capturedJson } = buildResponse(7);

    await controller.claim(buildRequest(ANON), res);

    expect(capturedStatus()).toBe(400);
    expect(capturedJson()).toEqual({
      code: 'empty_export',
      message: 'No cards found in your upload. Use .zip, .html, .md, or .csv.',
      empty_reason: 'all_filtered',
    });
    expect(trackMock).not.toHaveBeenCalledWith(
      'anonymous_partial_claimed',
      expect.anything()
    );
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

  describe('plan holds', () => {
    async function seedPlanHold(repo: InMemoryHeldDeckRepository) {
      await repo.insert({
        storageKey: 'held/plan.html',
        anonId: planHoldKey('42'),
        filename: 'notes.html',
        cardCount: 10,
        cardsHeldBack: 5,
        expiresAt: new Date(Date.now() + 60_000),
      });
    }

    it('reports no hold to an owner who has not paid yet', async () => {
      const repo = new InMemoryHeldDeckRepository();
      await seedPlanHold(repo);
      const controller = new ClaimHeldDeckController(buildUseCase(repo));
      const { res, capturedStatus } = buildResponse(42);

      await controller.check(buildRequest(null), res);

      expect(capturedStatus()).toBe(204);
    });

    it('claims the full deck for a paying owner and records it as a plan claim', async () => {
      trackMock.mockClear();
      const repo = new InMemoryHeldDeckRepository();
      await seedPlanHold(repo);
      const controller = new ClaimHeldDeckController(buildUseCase(repo));
      const { res, capturedStatus, capturedJson } = buildResponse(42);
      (res.locals as Record<string, unknown>).subscriber = true;

      await controller.claim(buildRequest(null), res);

      expect(capturedStatus()).toBe(200);
      expect(capturedJson()).toEqual({
        downloadKey: 'owner-key.apkg',
        cardCount: 34,
        deckName: 'notes',
        kind: 'plan',
      });
      expect(trackMock).toHaveBeenCalledWith('monthly_partial_claimed', {
        userId: 42,
        anonymousId: null,
        props: { card_count: 34, also_claimed: 0 },
      });
      expect(trackMock).not.toHaveBeenCalledWith(
        'anonymous_partial_claimed',
        expect.anything()
      );
    });

    it('records a claim of a deck the connector saved as coming from the connector', async () => {
      trackMock.mockClear();
      const repo = new InMemoryHeldDeckRepository();
      await repo.insert({
        storageKey: 'held/connector.md',
        anonId: planHoldKey('42'),
        filename: 'Biology.md',
        cardCount: 0,
        cardsHeldBack: 15,
        expiresAt: new Date(Date.now() + 60_000),
        source: 'mcp',
      });
      const controller = new ClaimHeldDeckController(buildUseCase(repo));
      const { res, capturedJson } = buildResponse(42);
      (res.locals as Record<string, unknown>).subscriber = true;

      await controller.claim(buildRequest(null), res);

      expect(capturedJson()).not.toHaveProperty('source');
      expect(trackMock).toHaveBeenCalledWith('monthly_partial_claimed', {
        userId: 42,
        anonymousId: null,
        props: { card_count: 34, also_claimed: 0, source: 'mcp' },
      });
    });

    it('says how many other plan decks the claim built, and records it', async () => {
      trackMock.mockClear();
      const repo = new InMemoryHeldDeckRepository();
      await seedPlanHold(repo);
      await seedPlanHold(repo);
      const controller = new ClaimHeldDeckController(buildUseCase(repo));
      const { res, capturedJson } = buildResponse(42);
      (res.locals as Record<string, unknown>).subscriber = true;

      await controller.claim(buildRequest(null), res);

      expect(capturedJson()).toMatchObject({ kind: 'plan', alsoClaimed: 1 });
      expect(trackMock).toHaveBeenCalledWith('monthly_partial_claimed', {
        userId: 42,
        anonymousId: null,
        props: { card_count: 34, also_claimed: 1 },
      });
    });
  });
});
