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
import { PrepareDeck } from '../../infrastracture/adapters/fileConversion/PrepareDeck';
import { normalizeUploadFilenames } from '../../routes/middleware/normalizeUploadFilenames';

const OWNER = 4242;
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
    { check: () => true }
  );
  const app = express();
  app.post(
    '/api/upload/retry-with-credential',
    (_req, res, next) => {
      Object.assign(res.locals, session.locals);
      next();
    },
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

async function unlock(
  who: Session,
  fields: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  session = who;
  const form = new FormData();
  form.append('credential', 'secret');
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  form.append(
    'file',
    new Blob(['%PDF-1.4 locked'], { type: 'application/pdf' }),
    'Locked notes.pdf'
  );
  const response = await fetch(`${baseUrl}/api/upload/retry-with-credential`, {
    method: 'POST',
    body: form,
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { status: response.status, body };
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
