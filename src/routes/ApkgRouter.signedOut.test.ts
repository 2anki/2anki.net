import { vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import os from 'node:os';
import type { AddressInfo } from 'node:net';

import {
  headerOf,
  jsonBodyOf,
  sendRawHttpRequest,
  statusOf,
} from '../test/rawHttpRequest';
import { UNREAD_BODY_DRAIN_LIMIT_BYTES } from './middleware/refuseUnreadBody';
import { ApkgTooLargeError } from '../services/ApkgPreviewService/extractApkg';

const getPrintUsage = vi.fn();
const incrementPrintUsage = vi.fn();
const parseForPreview = vi.fn();
const previewParsed = vi.fn();
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

vi.mock('./middleware/configureUserLocal', () => ({
  configureUserLocal: vi.fn(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const token = req.cookies?.token;
      if (token === 'free') {
        res.locals.owner = 7;
      }
      if (token === 'paying') {
        res.locals.owner = 8;
        res.locals.subscriber = true;
      }
    }
  ),
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
      return { parseForPreview, previewParsed, execute };
    }),
  };
});

import ApkgRouter from './ApkgRouter';

const BOUNDARY = 'printboundary';

function multipartHead(
  route: string,
  framing: string,
  extraHeaders = ''
): string {
  return (
    `POST ${route} HTTP/1.1\r\n` +
    'Host: 127.0.0.1\r\n' +
    `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n` +
    extraHeaders +
    framing +
    '\r\n'
  );
}

function multipartBody(fileBytes: number): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="deck.apkg"\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n'
    ),
    Buffer.alloc(fileBytes, 97),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

function inChunks(body: Buffer, size: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < body.length; offset += size) {
    chunks.push(body.subarray(offset, offset + size));
  }
  return chunks;
}

function chunkedFraming(chunks: Buffer[]): Buffer[] {
  return chunks.map((chunk) =>
    Buffer.concat([
      Buffer.from(`${chunk.length.toString(16)}\r\n`),
      chunk,
      Buffer.from('\r\n'),
    ])
  );
}

async function withServer<T>(run: (port: number) => Promise<T>): Promise<T> {
  process.env.UPLOAD_BASE = os.tmpdir();
  const app = express();
  app.use(cookieParser());
  app.use(ApkgRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function postDeckAs(
  port: number,
  route: string,
  token: string | null
): Promise<Response> {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('deck')]), 'deck.apkg');
  return fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    body: form,
    headers: token == null ? undefined : { Cookie: `token=${token}` },
  });
}

describe('ApkgRouter print routes without a session', () => {
  beforeEach(() => {
    getPrintUsage.mockReset().mockResolvedValue({ prints_used: 0 });
    incrementPrintUsage.mockReset().mockResolvedValue(undefined);
    parseForPreview.mockReset().mockResolvedValue({ parsedAt: 0 });
    previewParsed.mockReset().mockResolvedValue({
      image: Buffer.from('png'),
      totalCards: 10,
      previewedCards: 3,
      deckName: 'deck',
    });
    execute.mockReset().mockResolvedValue({ pdf: Buffer.from('%PDF') });
  });

  it.each(['/api/apkg/pdf/preview', '/api/apkg/pdf'])(
    'answers %s with a 401 the proxy can deliver, after reading a deck under the bound',
    async (route) => {
      const body = multipartBody(256 * 1024);
      const result = await withServer((port) =>
        sendRawHttpRequest({
          port,
          head: multipartHead(
            route,
            `Content-Length: ${body.length}\r\n`,
            'Connection: close\r\n'
          ),
          chunks: inChunks(body, 16 * 1024),
          chunkDelayMs: 1,
        })
      );

      expect(result.socketError).toBeNull();
      expect(result.timedOut).toBe(false);
      expect(result.bytesSent).toBe(body.length);
      expect(result.firstResponseByteAfterBytes).toBe(body.length);
      expect(statusOf(result.response)).toBe(401);
      expect(jsonBodyOf(result.response)).toEqual({
        message: 'Authentication required',
      });
    }
  );

  it('refuses a declared body over the bound at once and closes without reading it', async () => {
    const declared = 50 * 1024 * 1024;
    const result = await withServer((port) =>
      sendRawHttpRequest({
        port,
        head: multipartHead(
          '/api/apkg/pdf/preview',
          `Content-Length: ${declared}\r\n`
        ),
        chunks: inChunks(Buffer.alloc(declared, 97), 64 * 1024),
        chunkDelayMs: 5,
        stopWritingOnResponse: true,
      })
    );

    expect(result.timedOut).toBe(false);
    expect(statusOf(result.response)).toBe(401);
    expect(headerOf(result.response, 'Connection')).toBe('close');
    expect(jsonBodyOf(result.response)).toEqual({
      message: 'Authentication required',
    });
    expect(result.bytesSent).toBeLessThan(UNREAD_BODY_DRAIN_LIMIT_BYTES);
  });

  it('stops reading a chunked body once it passes the bound and closes', async () => {
    const total = 32 * 1024 * 1024;
    const result = await withServer((port) =>
      sendRawHttpRequest({
        port,
        head: multipartHead(
          '/api/apkg/pdf/preview',
          'Transfer-Encoding: chunked\r\n'
        ),
        chunks: chunkedFraming(inChunks(Buffer.alloc(total, 97), 64 * 1024)),
        chunkDelayMs: 2,
        stopWritingOnResponse: true,
      })
    );

    expect(result.timedOut).toBe(false);
    expect(statusOf(result.response)).toBe(401);
    expect(headerOf(result.response, 'Connection')).toBe('close');
    expect(jsonBodyOf(result.response)).toEqual({
      message: 'Authentication required',
    });
    expect(result.firstResponseByteAfterBytes).toBeGreaterThan(
      UNREAD_BODY_DRAIN_LIMIT_BYTES
    );
    expect(result.bytesSent).toBeLessThan(total / 4);
  });
});

describe('ApkgRouter print routes with a session', () => {
  beforeEach(() => {
    getPrintUsage.mockReset().mockResolvedValue({ prints_used: 0 });
    incrementPrintUsage.mockReset().mockResolvedValue(undefined);
    parseForPreview.mockReset().mockResolvedValue({ parsedAt: 0 });
    previewParsed.mockReset().mockResolvedValue({
      image: Buffer.from('png'),
      totalCards: 10,
      previewedCards: 3,
      deckName: 'deck',
    });
    execute.mockReset().mockResolvedValue({ pdf: Buffer.from('%PDF') });
  });

  it('previews a small deck for a signed-in free user', async () => {
    const res = await withServer((port) =>
      postDeckAs(port, '/api/apkg/pdf/preview', 'free')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      totalCards: 10,
      previewedCards: 3,
    });
  });

  it('prints the PDF for a signed-in free user within the monthly print', async () => {
    const res = await withServer((port) =>
      postDeckAs(port, '/api/apkg/pdf', 'free')
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('refuses the PDF to a signed-in free user whose monthly print is used', async () => {
    getPrintUsage.mockResolvedValue({ prints_used: 1 });

    const res = await withServer((port) =>
      postDeckAs(port, '/api/apkg/pdf', 'free')
    );

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      message: 'Your free PDF for this month has been used.',
    });
  });

  it('prints the PDF for a paying user without reading the quota', async () => {
    const res = await withServer((port) =>
      postDeckAs(port, '/api/apkg/pdf', 'paying')
    );

    expect(res.status).toBe(200);
    expect(getPrintUsage).not.toHaveBeenCalled();
  });

  it('answers a deck too large to preview with a 413', async () => {
    parseForPreview.mockRejectedValue(new ApkgTooLargeError());

    const res = await withServer((port) =>
      postDeckAs(port, '/api/apkg/pdf/preview', 'free')
    );

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      message: 'This Anki package is too large to process.',
    });
  });

  it('answers too many previews from one user with a 429', async () => {
    const statuses = await withServer(async (port) => {
      const seen: number[] = [];
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const res = await postDeckAs(port, '/api/apkg/pdf/preview', 'free');
        await res.arrayBuffer();
        seen.push(res.status);
      }
      return seen;
    });

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
  });
});
