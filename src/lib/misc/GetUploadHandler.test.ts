import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withNormalizedFilenames } from './GetUploadHandler';
import { UploadedFile } from '../storage/types';
import { getFileContents } from '../../usecases/uploads/worker';

function makeDiskFile(filePath: string, name = 'notes.html'): UploadedFile {
  return {
    originalname: name,
    key: name,
    path: filePath,
  } as UploadedFile;
}

function makeReqRes(files: UploadedFile[]): {
  req: express.Request;
  res: express.Response;
} {
  const req = { files } as unknown as express.Request;
  const res = {} as express.Response;
  return { req, res };
}

describe('withNormalizedFilenames', () => {
  let tmpDir: string;
  let tmpPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-handler-'));
    tmpPath = path.join(tmpDir, 'abc123def456'); // multer dest names have no extension
    fs.writeFileSync(tmpPath, Buffer.from('disk-bytes'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('snapshots disk bytes into buffer the moment multer finishes writing', () => {
    const file = makeDiskFile(tmpPath);
    const { req, res } = makeReqRes([file]);
    const wrapped = withNormalizedFilenames((_req, _res, next) => next());

    const callback = jest.fn();
    wrapped(req, res, callback);

    expect(callback).toHaveBeenCalledWith();
    expect(file.buffer).toEqual(Buffer.from('disk-bytes'));
  });

  it('keeps the conversion alive when the temp file is reaped after receipt', () => {
    const file = makeDiskFile(tmpPath);
    const { req, res } = makeReqRes([file]);
    const wrapped = withNormalizedFilenames((_req, _res, next) => next());

    wrapped(req, res, jest.fn());
    // The temp file under UPLOAD_BASE vanishes before the worker reads it.
    fs.rmSync(tmpPath);

    // Before this fix the snapshot ran too late (inside the use case, after an
    // async hop), so by request time the file was already gone and the worker
    // threw "no longer available on disk and has no buffer fallback". The
    // receipt-time capture populates the buffer fallback instead.
    expect(getFileContents(file)).toEqual(Buffer.from('disk-bytes'));
  });

  it('decodes the filename before snapshotting and still captures bytes', () => {
    const mojibake = Buffer.from('résumé', 'utf8').toString('latin1');
    const file = makeDiskFile(tmpPath, `${mojibake}.html`);
    const { req, res } = makeReqRes([file]);
    const wrapped = withNormalizedFilenames((_req, _res, next) => next());

    wrapped(req, res, jest.fn());

    expect(file.originalname).toBe('résumé.html');
    expect(file.buffer).toEqual(Buffer.from('disk-bytes'));
  });

  it('still snapshots after Node auto-destroys the fully read request', () => {
    // Node 16+ marks IncomingMessage destroyed once its body has been read, so
    // by the time multer calls back every healthy request reads as destroyed.
    const file = makeDiskFile(tmpPath);
    const req = {
      files: [file],
      destroyed: true,
      aborted: false,
    } as unknown as express.Request;
    const res = {} as express.Response;
    const wrapped = withNormalizedFilenames((_req, _res, next) => next());

    const callback = jest.fn();
    wrapped(req, res, callback);

    expect(callback).toHaveBeenCalledWith();
    expect(file.buffer).toEqual(Buffer.from('disk-bytes'));
  });

  it('skips the snapshot entirely when the request already aborted', () => {
    fs.rmSync(tmpPath); // multer 2.x removes temp files when the client aborts
    const file = makeDiskFile(tmpPath);
    const req = {
      files: [file],
      aborted: true,
    } as unknown as express.Request;
    const res = {} as express.Response;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const wrapped = withNormalizedFilenames((_req, _res, next) => next());

    const callback = jest.fn();
    wrapped(req, res, callback);

    expect(callback).toHaveBeenCalledWith();
    expect(file.buffer).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips the snapshot when the response is already finished', () => {
    fs.rmSync(tmpPath);
    const file = makeDiskFile(tmpPath);
    const { req } = makeReqRes([file]);
    const res = { writableEnded: true } as unknown as express.Response;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const wrapped = withNormalizedFilenames((_req, _res, next) => next());

    wrapped(req, res, jest.fn());

    expect(file.buffer).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('forwards multer errors without snapshotting', () => {
    const file = makeDiskFile(tmpPath);
    const { req, res } = makeReqRes([file]);
    const multerError = new Error('LIMIT_FILE_SIZE');
    const wrapped = withNormalizedFilenames((_req, _res, next) =>
      next(multerError)
    );

    const callback = jest.fn();
    wrapped(req, res, callback);

    expect(callback).toHaveBeenCalledWith(multerError);
    expect(file.buffer).toBeUndefined();
  });
});
