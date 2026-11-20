import { PassThrough, Writable } from 'node:stream';
import type express from 'express';
import {
  countFileStarted,
  pipeCountingBodyBytes,
  readUploadStreamProgress,
} from './uploadStreamProgress';

function requestWithHeaders(
  headers: Record<string, string> = {}
): express.Request {
  return Object.assign(new PassThrough(), {
    headers,
  }) as unknown as express.Request;
}

function stalledWritable(): Writable {
  return new Writable({ highWaterMark: 1, write: () => undefined });
}

function collectingWritable(chunks: Buffer[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  });
}

describe('readUploadStreamProgress', () => {
  it.each([
    ['123', 123],
    ['0', 0],
    ['abc', null],
    ['-1', null],
    ['1.5', null],
    ['', null],
  ])('reads a content-length of %j as %j', (header, expected) => {
    const req = requestWithHeaders({ 'content-length': header });

    expect(readUploadStreamProgress(req).contentLength).toBe(expected);
  });

  it('reports nothing read for a request multer never fed to busboy', () => {
    expect(readUploadStreamProgress(requestWithHeaders())).toEqual({
      contentLength: null,
      bytesReceived: 0,
      elapsedMs: null,
      filesStarted: 0,
    });
  });
});

describe('pipeCountingBodyBytes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes every byte to busboy unchanged and counts them', async () => {
    const req = requestWithHeaders();
    const received: Buffer[] = [];
    const busboy = collectingWritable(received);
    pipeCountingBodyBytes(req, busboy);

    (req as unknown as PassThrough).end(Buffer.from('abcdefghij'));
    await new Promise((resolve) => busboy.on('finish', resolve));

    expect(Buffer.concat(received).toString()).toBe('abcdefghij');
    expect(readUploadStreamProgress(req).bytesReceived).toBe(10);
  });

  it('leaves the stream paused while busboy is applying backpressure', async () => {
    const req = requestWithHeaders();
    pipeCountingBodyBytes(req, stalledWritable());

    (req as unknown as PassThrough).write(Buffer.from('first'));
    (req as unknown as PassThrough).write(Buffer.from('second'));
    await new Promise((resolve) => setImmediate(resolve));

    expect((req as unknown as PassThrough).readableFlowing).toBe(false);
    expect(readUploadStreamProgress(req).bytesReceived).toBe(5);
  });

  it('measures the time since busboy was fed and counts files begun', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const req = requestWithHeaders();
    pipeCountingBodyBytes(req, stalledWritable());
    countFileStarted(req);
    countFileStarted(req);

    vi.advanceTimersByTime(250);

    expect(readUploadStreamProgress(req)).toMatchObject({
      elapsedMs: 250,
      filesStarted: 2,
    });
  });
});
