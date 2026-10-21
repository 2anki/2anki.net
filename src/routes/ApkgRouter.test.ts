import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import type { AddressInfo } from 'node:net';

const getPrintUsage = vi.fn();
const incrementPrintUsage = vi.fn();
const preview = vi.fn();
const execute = vi.fn();

vi.mock('../data_layer', () => ({
  getDatabase: vi.fn().mockReturnValue({}),
}));

vi.mock('../data_layer/UsersRepository', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return { getPrintUsage, incrementPrintUsage };
  }),
}));

vi.mock('./middleware/RequireAllowedOrigin', () => ({
  __esModule: true,
  default: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('./middleware/RequireAuthentication', () => ({
  __esModule: true,
  default: (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void
  ) => {
    res.locals.owner = 7;
    next();
  },
}));

vi.mock('../usecases/apkg/ExportApkgToPdfUseCase', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../usecases/apkg/ExportApkgToPdfUseCase')
    >();
  return {
    ...actual,
    __esModule: true,
    default: vi.fn().mockImplementation(function () {
      return { preview, execute };
    }),
  };
});

import ApkgRouter from './ApkgRouter';

async function postDeck(route: string): Promise<Response> {
  process.env.UPLOAD_BASE = os.tmpdir();
  const app = express();
  app.use(ApkgRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('deck')]), 'deck.apkg');
    return await fetch(`http://127.0.0.1:${port}${route}`, {
      method: 'POST',
      body: form,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('ApkgRouter print preview', () => {
  beforeEach(() => {
    getPrintUsage.mockReset().mockResolvedValue({ prints_used: 1 });
    incrementPrintUsage.mockReset().mockResolvedValue(undefined);
    preview.mockReset().mockResolvedValue({
      image: Buffer.from('png'),
      totalCards: 10,
      previewedCards: 3,
      deckName: 'deck',
    });
  });

  it('refuses the full PDF to a free user whose monthly print is used', async () => {
    const res = await postDeck('/api/apkg/pdf');

    expect(res.status).toBe(402);
  });

  it('still previews for that user and never spends their print', async () => {
    const res = await postDeck('/api/apkg/pdf/preview');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      totalCards: 10,
      previewedCards: 3,
    });
    expect(getPrintUsage).not.toHaveBeenCalled();
    expect(incrementPrintUsage).not.toHaveBeenCalled();
  });
});
