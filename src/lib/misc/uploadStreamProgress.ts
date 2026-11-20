import type express from 'express';

export interface UploadStreamProgress {
  contentLength: number | null;
  bytesReceived: number;
  elapsedMs: number | null;
  filesStarted: number;
}

interface BodyReadCounter {
  startedAt: number;
  bytesReceived: number;
  filesStarted: number;
}

const counters = new WeakMap<express.Request, BodyReadCounter>();

export function pipeCountingBodyBytes(
  req: express.Request,
  busboy: NodeJS.WritableStream
): void {
  req.pipe(busboy);
  const counter: BodyReadCounter = {
    startedAt: performance.now(),
    bytesReceived: 0,
    filesStarted: 0,
  };
  counters.set(req, counter);
  req.on('data', (chunk: Buffer) => {
    counter.bytesReceived += chunk.length;
  });
}

export function countFileStarted(req: express.Request): void {
  const counter = counters.get(req);
  if (counter != null) {
    counter.filesStarted += 1;
  }
}

function declaredContentLength(req: express.Request): number | null {
  const header = req.headers?.['content-length'];
  if (header == null || !/^\d+$/.test(header)) {
    return null;
  }
  return Number(header);
}

export function readUploadStreamProgress(
  req: express.Request
): UploadStreamProgress {
  const counter = counters.get(req);
  return {
    contentLength: declaredContentLength(req),
    bytesReceived: counter?.bytesReceived ?? 0,
    elapsedMs:
      counter == null
        ? null
        : Math.round(performance.now() - counter.startedAt),
    filesStarted: counter?.filesStarted ?? 0,
  };
}
