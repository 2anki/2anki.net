import DownloadController from './DownloadController';
import { Request, Response } from 'express';
import { Readable, Writable } from 'stream';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { track } from '../services/events/track';

jest.mock('../services/events/track', () => ({ track: jest.fn() }));

const trackMock = track as jest.Mock;

beforeEach(() => {
  trackMock.mockClear();
});

type StreamingMockResponse = Response & {
  _headers: Record<string, string>;
  _chunks: Buffer[];
  _done: Promise<void>;
};

// getFile pipes the storage stream into the response, so the mock has to be
// a real Writable; the collected chunks stand in for what the client got.
function mockResponse(): StreamingMockResponse {
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  sink.on('finish', () => resolveDone());
  const res = Object.assign(sink, {
    locals: { owner: 'test-owner' },
    headersSent: false,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    send: jest.fn(),
    status: jest.fn().mockReturnThis(),
    redirect: jest.fn(),
    _headers: headers,
    _chunks: chunks,
    _done: done,
  });
  return res as unknown as StreamingMockResponse;
}

function fakeApkgStream() {
  return {
    body: Readable.from([Buffer.from('fake-apkg')]),
    contentLength: 9,
  };
}

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    isValidKey: () => true,
    getFileStream: jest.fn().mockImplementation(async () => fakeApkgStream()),
    getFilename: jest.fn().mockResolvedValue(null),
    isMissingDownloadError: () => false,
    deleteMissingFile: jest.fn(),
    ...overrides,
  };
}

describe('DownloadController.getFile', () => {
  it('sets Content-Type and Content-Disposition headers for .apkg files', async () => {
    const controller = new DownloadController(makeService() as any);
    const req = { params: { key: '123-deck.apkg' } } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as any);
    await res._done;

    expect(Buffer.concat(res._chunks).toString()).toBe('fake-apkg');
    expect(res.send).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/octet-stream'
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '9');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="123-deck.apkg"; filename*=UTF-8\'\'123-deck.apkg'
    );
  });

  it('appends .apkg extension when key lacks it', async () => {
    const controller = new DownloadController(makeService() as any);
    const req = { params: { key: '123-deck' } } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as any);
    await res._done;

    expect(Buffer.concat(res._chunks).toString()).toBe('fake-apkg');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="123-deck.apkg"; filename*=UTF-8\'\'123-deck.apkg'
    );
  });

  it('uses the friendly deck name from DB when available', async () => {
    const controller = new DownloadController(
      makeService({
        getFilename: jest.fn().mockResolvedValue('My Custom Deck'),
      }) as any
    );
    const req = {
      params: { key: 'owner-1234-uuid.apkg' },
    } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as any);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="My Custom Deck.apkg"; filename*=UTF-8\'\'My%20Custom%20Deck.apkg'
    );
  });

  it('falls back to the page-title slug when no custom name and no DB name', async () => {
    const controller = new DownloadController(makeService() as any);
    const req = {
      params: { key: 'owner-1234-uuid.apkg' },
    } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as any);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="owner-1234-uuid.apkg"; filename*=UTF-8\'\'owner-1234-uuid.apkg'
    );
  });
});

describe('DownloadController.getFile streaming', () => {
  function neverEndingStream() {
    return new Readable({
      read() {
        /* the test drives this stream by hand */
      },
    });
  }

  it('omits Content-Length when storage does not report one', async () => {
    const service = makeService({
      getFileStream: jest.fn().mockResolvedValue({
        body: Readable.from([Buffer.from('x')]),
        contentLength: undefined,
      }),
    });
    const controller = new DownloadController(service as never);
    const req = { params: { key: 'deck.apkg' } } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as never);
    await res._done;

    expect(res._headers['Content-Length']).toBeUndefined();
  });

  it('stops pulling from storage when the client goes away mid-download', async () => {
    const body = neverEndingStream();
    const service = makeService({
      getFileStream: jest.fn().mockResolvedValue({ body, contentLength: 10 }),
    });
    const controller = new DownloadController(service as never);
    const req = { params: { key: 'deck.apkg' } } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as never);
    expect(body.destroyed).toBe(false);

    res.emit('close');

    expect(body.destroyed).toBe(true);
  });

  it('tears the response down when storage fails after bytes were sent', async () => {
    const body = neverEndingStream();
    const service = makeService({
      getFileStream: jest.fn().mockResolvedValue({ body, contentLength: 10 }),
    });
    const controller = new DownloadController(service as never);
    const req = { params: { key: 'deck.apkg' } } as unknown as Request;
    const res = mockResponse();
    const destroySpy = jest.spyOn(res, 'destroy').mockImplementation(() => res);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await controller.getFile(req, res, {} as never);
    res.headersSent = true;
    body.emit('error', Object.assign(new Error('boom'), { name: 'SlowDown' }));

    expect(destroySpy).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(503);
    errorSpy.mockRestore();
  });

  it('answers 503 when storage fails before any byte was sent', async () => {
    const body = neverEndingStream();
    const service = makeService({
      getFileStream: jest.fn().mockResolvedValue({ body, contentLength: 10 }),
    });
    const controller = new DownloadController(service as never);
    const req = { params: { key: 'deck.apkg' } } as unknown as Request;
    const res = mockResponse();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await controller.getFile(req, res, {} as never);
    body.emit('error', Object.assign(new Error('boom'), { name: 'SlowDown' }));

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.send).toHaveBeenCalledWith(
      'Storage is busy right now. Try the download again in a moment.'
    );
    errorSpy.mockRestore();
  });
});

describe('DownloadController.getBulkDownload', () => {
  let workspaceBase: string;
  let originalWorkspaceBase: string | undefined;

  beforeEach(() => {
    workspaceBase = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-test-'));
    originalWorkspaceBase = process.env.WORKSPACE_BASE;
    process.env.WORKSPACE_BASE = workspaceBase;
  });

  afterEach(() => {
    fs.rmSync(workspaceBase, { recursive: true, force: true });
    if (originalWorkspaceBase === undefined) {
      delete process.env.WORKSPACE_BASE;
    } else {
      process.env.WORKSPACE_BASE = originalWorkspaceBase;
    }
  });

  function streamingResponse(): {
    res: Response;
    chunks: Buffer[];
    done: Promise<void>;
  } {
    const chunks: Buffer[] = [];
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
    });
    sink.on('finish', () => resolveDone());

    const res = Object.assign(sink, {
      headersSent: false,
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    }) as unknown as Response;

    return { res, chunks, done };
  }

  it('streams a zip archive of the .apkg files in the workspace', async () => {
    const id = 'workspace-with-decks';
    const workspace = path.join(workspaceBase, id);
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, 'deck-one.apkg'), 'fake-apkg-one');
    fs.writeFileSync(path.join(workspace, 'deck-two.apkg'), 'fake-apkg-two');

    const controller = new DownloadController(makeService() as any);
    const req = { params: { id } } as unknown as Request;
    const { res, chunks, done } = streamingResponse();

    controller.getBulkDownload(req, res);
    await done;

    expect(res.status as jest.Mock).not.toHaveBeenCalledWith(500);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/zip'
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(Buffer.concat(chunks).subarray(0, 2).toString()).toBe('PK');
  });

  it('fires deck_downloaded once with bulk:true and file_count', async () => {
    const id = 'bulk-event-workspace';
    const workspace = path.join(workspaceBase, id);
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, 'one.apkg'), 'a');
    fs.writeFileSync(path.join(workspace, 'two.apkg'), 'b');
    fs.writeFileSync(path.join(workspace, 'three.apkg'), 'c');

    const controller = new DownloadController(makeService() as any);
    const req = { params: { id } } as unknown as Request;
    const { res, done } = streamingResponse();

    controller.getBulkDownload(req, res);
    await done;

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith('deck_downloaded', {
      userId: null,
      anonymousId: null,
      props: { workspace_id: id, bulk: true, file_count: 3 },
    });
  });

  it('does not fire deck_downloaded when the workspace has no .apkg files', async () => {
    const id = 'bulk-empty-workspace';
    const workspace = path.join(workspaceBase, id);
    fs.mkdirSync(workspace);

    const controller = new DownloadController(makeService() as any);
    const req = { params: { id } } as unknown as Request;
    const res = mockResponse();

    await controller.getBulkDownload(req, res);

    expect(trackMock).not.toHaveBeenCalled();
  });
});

describe('DownloadController.getLocalFile', () => {
  let workspaceBase: string;
  let originalWorkspaceBase: string | undefined;

  beforeEach(() => {
    workspaceBase = fs.mkdtempSync(path.join(os.tmpdir(), 'local-test-'));
    originalWorkspaceBase = process.env.WORKSPACE_BASE;
    process.env.WORKSPACE_BASE = workspaceBase;
  });

  afterEach(() => {
    fs.rmSync(workspaceBase, { recursive: true, force: true });
    if (originalWorkspaceBase === undefined) {
      delete process.env.WORKSPACE_BASE;
    } else {
      process.env.WORKSPACE_BASE = originalWorkspaceBase;
    }
  });

  function fileResponse() {
    return {
      sendFile: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
    } as unknown as Response;
  }

  it('fires deck_downloaded once with bulk:false on a successful send', () => {
    const id = 'local-event-workspace';
    const workspace = path.join(workspaceBase, id);
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, 'one.apkg'), 'a');

    const controller = new DownloadController(makeService() as any);
    const req = { params: { id, filename: 'one.apkg' } } as unknown as Request;
    const res = fileResponse();

    controller.getLocalFile(req, res);

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith('deck_downloaded', {
      userId: null,
      anonymousId: null,
      props: { workspace_id: id, bulk: false },
    });
    expect(res.sendFile).toHaveBeenCalled();
  });

  it('does not fire deck_downloaded when the file is missing', () => {
    const id = 'local-missing-workspace';
    const workspace = path.join(workspaceBase, id);
    fs.mkdirSync(workspace);

    const controller = new DownloadController(makeService() as any);
    const req = { params: { id, filename: 'gone.apkg' } } as unknown as Request;
    const res = fileResponse();

    controller.getLocalFile(req, res);

    expect(trackMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('DownloadController.getDownloadPage view model', () => {
  let workspaceBase: string;
  let originalWorkspaceBase: string | undefined;

  beforeEach(() => {
    workspaceBase = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-page-test-'));
    originalWorkspaceBase = process.env.WORKSPACE_BASE;
    process.env.WORKSPACE_BASE = workspaceBase;
  });

  afterEach(() => {
    fs.rmSync(workspaceBase, { recursive: true, force: true });
    if (originalWorkspaceBase === undefined) {
      delete process.env.WORKSPACE_BASE;
    } else {
      process.env.WORKSPACE_BASE = originalWorkspaceBase;
    }
  });

  function makeJobRepository(title: string | null = null) {
    return {
      findJobByObjectId: jest
        .fn()
        .mockResolvedValue(
          title != null ? { title, created_at: new Date() } : undefined
        ),
    };
  }

  it('renders page HTML with displayName for each .apkg file', async () => {
    const id = 'ws-view-model';
    const workspace = path.join(workspaceBase, id);
    fs.mkdirSync(workspace);
    fs.writeFileSync(
      path.join(workspace, '-Biology-Notes-5827131637243234.apkg'),
      'x'.repeat(1000)
    );

    const controller = new DownloadController(
      makeService() as any,
      makeJobRepository('My Source') as any
    );
    const req = { params: { id } } as unknown as Request;
    const res = mockResponse();

    await controller.getDownloadPage(req, res);

    const html = (res.send as jest.Mock).mock.calls[0][0] as string;
    expect(html).toContain('Biology Notes');
    expect(html).toContain('My Source');
    expect(html).not.toContain('>-Biology-Notes-5827131637243234.apkg<');
  });

  it('renders without subhead when jobs row is missing', async () => {
    const id = 'ws-no-job';
    const workspace = path.join(workspaceBase, id);
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, 'Deck-A.apkg'), 'data');

    const controller = new DownloadController(
      makeService() as any,
      makeJobRepository(null) as any
    );
    const req = { params: { id } } as unknown as Request;
    const res = mockResponse();

    await controller.getDownloadPage(req, res);

    const html = (res.send as jest.Mock).mock.calls[0][0] as string;
    expect(html).toContain('1 deck ready');
    expect(html).not.toContain('From ');
  });

  it('renders empty state when workspace has no .apkg files', async () => {
    const id = 'ws-empty';
    const workspace = path.join(workspaceBase, id);
    fs.mkdirSync(workspace);

    const controller = new DownloadController(
      makeService() as any,
      makeJobRepository(null) as any
    );
    const req = { params: { id } } as unknown as Request;
    const res = mockResponse();

    await controller.getDownloadPage(req, res);

    const html = (res.send as jest.Mock).mock.calls[0][0] as string;
    expect(html).toContain('No decks found in your upload');
  });
});

describe('DownloadController.getFile storage error handling', () => {
  function makeServiceThatThrows(
    error: unknown,
    overrides: Record<string, unknown> = {}
  ) {
    return makeService({
      getFileStream: jest.fn().mockRejectedValue(error),
      isMissingDownloadError: (e: unknown) =>
        (e as { name?: string })?.name?.includes('NoSuchKey') === true,
      isTransientStorageError: jest
        .fn()
        .mockImplementation(
          (e: unknown) => (e as { transient?: boolean })?.transient === true
        ),
      deleteMissingFile: jest.fn(),
      ...overrides,
    });
  }

  it('redirects and drops the row when the object is gone (NoSuchKey)', async () => {
    const error = Object.assign(new Error('not found'), { name: 'NoSuchKey' });
    const service = makeServiceThatThrows(error);
    const controller = new DownloadController(service as never);
    const req = { params: { key: 'deck.apkg' } } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as never);

    expect(service.deleteMissingFile).toHaveBeenCalledWith(
      'test-owner',
      'deck.apkg'
    );
    expect(res.redirect).toHaveBeenCalledWith('/downloads');
  });

  it('returns 503 with a retry message on a transient storage error', async () => {
    const error = Object.assign(new Error('connection reset'), {
      transient: true,
    });
    const service = makeServiceThatThrows(error);
    const controller = new DownloadController(service as never);
    const req = { params: { key: 'deck.apkg' } } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.send).toHaveBeenCalledWith(
      'Storage is busy right now. Try the download again in a moment.'
    );
  });

  it('does not leak raw storage error text on a transient failure', async () => {
    const error = Object.assign(
      new Error('S3 internal: bucket=2anki-prod endpoint leaked'),
      { transient: true }
    );
    const service = makeServiceThatThrows(error);
    const controller = new DownloadController(service as never);
    const req = { params: { key: 'deck.apkg' } } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as never);

    const sent = (res.send as jest.Mock).mock.calls
      .map((c) => String(c[0]))
      .join('');
    expect(sent).not.toContain('2anki-prod');
    expect(sent).not.toContain('endpoint leaked');
  });

  it('falls back to the 404 expire page on an unknown error', async () => {
    const error = new Error('weird internal detail user must not see');
    const service = makeServiceThatThrows(error);
    const controller = new DownloadController(service as never);
    const req = { params: { key: 'deck.apkg' } } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as never);

    expect(res.status).toHaveBeenCalledWith(404);
    const sent = (res.send as jest.Mock).mock.calls
      .map((c) => String(c[0]))
      .join('');
    expect(sent).not.toContain('weird internal detail');
  });

  it('still logs an error for a genuinely unexpected failure', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('weird internal detail user must not see');
    const service = makeServiceThatThrows(error);
    const controller = new DownloadController(service as never);
    const req = { params: { key: 'deck.apkg' } } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as never);

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('DownloadController.getFile expired link logging', () => {
  it('returns the 404 expire page when the file is absent', async () => {
    const service = makeService({
      getFileStream: jest.fn().mockResolvedValue(null),
      isTransientStorageError: () => false,
    });
    const controller = new DownloadController(service as never);
    const req = { params: { key: 'expired-deck.apkg' } } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith(
      "Download link expire, try converting again <a href='/upload'>upload</a>"
    );
  });

  it('does not log an error for an absent file (expected expired link)', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const service = makeService({
      getFileStream: jest.fn().mockResolvedValue(null),
      isTransientStorageError: () => false,
    });
    const controller = new DownloadController(service as never);
    const req = { params: { key: 'expired-deck.apkg' } } as unknown as Request;
    const res = mockResponse();

    await controller.getFile(req, res, {} as never);

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
