import { vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import multer from 'multer';

// The PDF converter shells out to pdfinfo and the Python deck writer, which
// not every test machine has; the controller's own work is what runs here.
vi.mock('../../infrastracture/adapters/fileConversion/PrepareDeck', () => ({
  PrepareDeck: vi.fn(),
}));

import UploadController from './UploadController';
import type UploadService from '../../services/UploadService';
import type NotionService from '../../services/NotionService';
import type { CardUsage } from '../../usecases/uploads/RetryPdfWithCredentialUseCase';
import { PrepareDeck } from '../../infrastracture/adapters/fileConversion/PrepareDeck';
import { normalizeUploadFilenames } from '../../routes/middleware/normalizeUploadFilenames';
import { tellUploadOwner } from '../../routes/middleware/tellUploadOwner';
import { buildPdfPasswordSentinel } from '../../lib/pdf/pdfPasswordSentinel';
import {
  __resetFeatureFlagModuleForTests,
  __setFeatureFlagDependencies,
} from '../../lib/featureFlags/getFeatureFlag';
import { ANONYMOUS_DAY_PASS_CARD_FLAG } from '../../lib/upload/anonymousDayPassCard';
import { LIMIT_WALL_PASS_FIRST_FLAG } from '../../lib/featureFlags/limitWallPassFirst';

const OWNER = 4242;

const cardUsage = {
  cardsUsed: 0,
  getCardUsage: vi.fn(async () => ({
    cards_used: cardUsage.cardsUsed,
    month_started_at: new Date('2026-10-01T00:00:00Z'),
  })),
  incrementCardUsage: vi.fn(async () => 1),
};
const OTHER_OWNER = 9999;
const prepareDeck = vi.mocked(PrepareDeck);

interface Session {
  locals: Record<string, unknown>;
}

const signedIn: Session = {
  locals: { owner: OWNER, patreon: false, subscriber: false },
};
const signedOut: Session = { locals: {} };
const signedOutPassHolder: Session = {
  locals: { subscriber: true, passKind: '24h', anonymousPassId: 7 },
};

let session: Session = signedOut;
let server: http.Server;
let baseUrl: string;
let tempDir: string;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-kept-owner-'));
  const controller = new UploadController(
    {} as unknown as UploadService,
    {} as unknown as NotionService,
    undefined,
    undefined,
    undefined,
    undefined,
    { check: () => true },
    cardUsage as unknown as CardUsage
  );
  const app = express();
  app.post(
    '/api/upload/retry-with-credential',
    (_req, res, next) => {
      Object.assign(res.locals, session.locals);
      next();
    },
    tellUploadOwner,
    multer({ dest: tempDir }).single('file'),
    normalizeUploadFilenames,
    (req, res) => controller.retryPdfWithCredential(req, res)
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  cardUsage.cardsUsed = 0;
  cardUsage.getCardUsage.mockClear();
  cardUsage.incrementCardUsage.mockClear();
  prepareDeck.mockReset();
  prepareDeck.mockResolvedValue({
    apkg: Buffer.from('unlocked-apkg'),
    cardCount: 2,
    name: 'Locked notes.apkg',
  } as Awaited<ReturnType<typeof PrepareDeck>>);
});

afterEach(() => {
  for (const entry of fs.readdirSync(tempDir)) {
    fs.rmSync(path.join(tempDir, entry), { force: true });
  }
});

async function send(
  who: Session,
  fields: Record<string, string>,
  withFile: boolean
): Promise<{ status: number; owner: string | null; body: unknown }> {
  session = who;
  const form = new FormData();
  form.append('credential', 'secret');
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  if (withFile) {
    form.append(
      'file',
      new Blob(['%PDF-1.4 locked'], { type: 'application/pdf' }),
      'Locked notes.pdf'
    );
  }
  const response = await fetch(`${baseUrl}/api/upload/retry-with-credential`, {
    method: 'POST',
    body: form,
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return {
    status: response.status,
    owner: response.headers.get('x-upload-owner'),
    body,
  };
}

async function unlock(
  who: Session,
  fields: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  const { status, body } = await send(who, fields, true);
  return { status, body };
}

describe('a password unlock of a kept file on /api/upload/retry-with-credential', () => {
  it.each([
    ['the signed-in account that sent it', signedIn, String(OWNER)],
    ['a visitor who sent it signed out and still is', signedOut, 'none'],
    [
      'an anonymous Day Pass holder who sent it signed out',
      signedOutPassHolder,
      'none',
    ],
  ])('converts for %s', async (_label, who, keptOwner) => {
    const result = await unlock(who, { 'kept-owner': keptOwner });

    expect(result).toEqual({ status: 200, body: 'unlocked-apkg' });
    expect(prepareDeck).toHaveBeenCalledTimes(1);
  });

  it('converts an unlock with no kept owner, as older pages send', async () => {
    const result = await unlock(signedIn);

    expect(result).toEqual({ status: 200, body: 'unlocked-apkg' });
    expect(prepareDeck).toHaveBeenCalledTimes(1);
  });

  it('meters the anonymous Day Pass that sent the file', async () => {
    await unlock(signedOutPassHolder, { 'kept-owner': 'none' });

    expect(prepareDeck.mock.calls[0][0]).toMatchObject({
      userId: null,
      anonymousPassId: 7,
    });
  });

  it.each([
    ['another account', signedIn, String(OTHER_OWNER)],
    ['a signed-out visitor, now signed in', signedIn, 'none'],
    ['an account that has since signed out', signedOut, String(OWNER)],
    [
      'an account, now an anonymous Day Pass holder',
      signedOutPassHolder,
      String(OWNER),
    ],
  ])(
    'refuses a file sent by %s, converts nothing and removes the upload',
    async (_label, who, keptOwner) => {
      const result = await unlock(who, { 'kept-owner': keptOwner });

      expect(result).toEqual({
        status: 409,
        body: expect.objectContaining({ code: 'owner_changed' }),
      });
      expect(prepareDeck).not.toHaveBeenCalled();
      expect(fs.readdirSync(tempDir)).toEqual([]);
    }
  );
});

describe('the session a password unlock ran under, on every answer', () => {
  it('names it on an unlocked deck', async () => {
    expect(await send(signedIn, {}, true)).toMatchObject({
      status: 200,
      owner: String(OWNER),
    });
  });

  it('names it on a wrong password', async () => {
    prepareDeck.mockRejectedValue(
      new Error(buildPdfPasswordSentinel('Locked notes.pdf'))
    );

    expect(await send(signedIn, {}, true)).toMatchObject({
      status: 400,
      owner: String(OWNER),
    });
  });

  it('names it on a refused unlock, and says whether the session is signed in', async () => {
    expect(
      await send(signedOut, { 'kept-owner': String(OWNER) }, true)
    ).toEqual({
      status: 409,
      owner: 'none',
      body: expect.objectContaining({
        code: 'owner_changed',
        signed_in: false,
      }),
    });
  });

  it('names it on a request with no file', async () => {
    expect(await send(signedOutPassHolder, {}, false)).toMatchObject({
      status: 400,
      owner: 'none',
    });
  });
});

describe('the card limits on a password unlock', () => {
  async function unlockWithoutFollowing(who: Session) {
    session = who;
    const form = new FormData();
    form.append('credential', 'secret');
    form.append(
      'file',
      new Blob(['%PDF-1.4 locked'], { type: 'application/pdf' }),
      'Locked notes.pdf'
    );
    const response = await fetch(
      `${baseUrl}/api/upload/retry-with-credential`,
      { method: 'POST', body: form, redirect: 'manual' }
    );
    return {
      status: response.status,
      location: response.headers.get('location'),
    };
  }

  function deckOf(cardCount: number) {
    prepareDeck.mockResolvedValue({
      apkg: Buffer.from('unlocked-apkg'),
      cardCount,
      name: 'Locked notes.apkg',
    } as Awaited<ReturnType<typeof PrepareDeck>>);
  }

  it('sends a free account over its monthly allowance to the limit page and counts nothing', async () => {
    cardUsage.cardsUsed = 95;
    deckOf(10);

    const response = await unlockWithoutFollowing(signedIn);

    expect(response).toEqual({
      status: 302,
      location: '/limit?kind=card_count',
    });
    expect(cardUsage.incrementCardUsage).not.toHaveBeenCalled();
  });

  it("counts an unlocked deck against a free account's monthly allowance", async () => {
    cardUsage.cardsUsed = 10;
    deckOf(12);

    const response = await unlockWithoutFollowing(signedIn);

    expect(response.status).toBe(200);
    expect(cardUsage.incrementCardUsage).toHaveBeenCalledWith(OWNER, 12);
  });

  it.each([ANONYMOUS_DAY_PASS_CARD_FLAG, LIMIT_WALL_PASS_FIRST_FLAG])(
    'states the deck size on the anonymous wall when %s is on, as an upload does',
    async (flag) => {
      __setFeatureFlagDependencies({
        repository: {
          getAll: () => Promise.resolve([]),
          get: (key: string) => Promise.resolve(key === flag ? true : null),
          set: () => Promise.resolve(null),
        },
      });
      deckOf(30);
      try {
        const response = await unlockWithoutFollowing(signedOut);

        expect(response).toEqual({
          status: 302,
          location: '/limit?kind=anonymous&cards=30',
        });
      } finally {
        __resetFeatureFlagModuleForTests();
      }
    }
  );

  it('sends a signed-out visitor past the anonymous cap to the limit page', async () => {
    deckOf(30);

    const response = await unlockWithoutFollowing(signedOut);

    expect(response).toEqual({
      status: 302,
      location: '/limit?kind=anonymous',
    });
  });

  it.each([
    ['a subscriber', { owner: OWNER, patreon: false, subscriber: true }],
    ['a lifetime account', { owner: OWNER, patreon: true, subscriber: false }],
    [
      'a signed-in pass holder',
      { owner: OWNER, patreon: false, subscriber: true, passKind: '7d' },
    ],
  ])(
    'lets %s unlock a deck of any size without counting it',
    async (_who, locals) => {
      cardUsage.cardsUsed = 99;
      deckOf(300);

      const response = await unlockWithoutFollowing({ locals });

      expect(response.status).toBe(200);
      expect(cardUsage.getCardUsage).not.toHaveBeenCalled();
      expect(cardUsage.incrementCardUsage).not.toHaveBeenCalled();
    }
  );

  it('lets a pass holder unlock a deck of any size without counting it', async () => {
    deckOf(300);

    const response = await unlockWithoutFollowing(signedOutPassHolder);

    expect(response.status).toBe(200);
    expect(cardUsage.getCardUsage).not.toHaveBeenCalled();
  });
});
