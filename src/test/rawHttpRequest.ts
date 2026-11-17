import net from 'node:net';

export interface RawHttpRequest {
  port: number;
  head: string;
  chunks: Buffer[];
  chunkDelayMs?: number;
  stopWritingOnResponse?: boolean;
  timeoutMs?: number;
}

export interface RawHttpResult {
  response: string;
  bytesSent: number;
  socketError: string | null;
  firstResponseByteAfterBytes: number | null;
  timedOut: boolean;
}

export function sendRawHttpRequest({
  port,
  head,
  chunks,
  chunkDelayMs = 0,
  stopWritingOnResponse = false,
  timeoutMs = 10_000,
}: RawHttpRequest): Promise<RawHttpResult> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let response = '';
    let bytesSent = 0;
    let socketError: string | null = null;
    let firstResponseByteAfterBytes: number | null = null;
    let finished = false;
    const finish = (timedOut: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      socket.destroy();
      resolve({
        response,
        bytesSent,
        socketError,
        firstResponseByteAfterBytes,
        timedOut,
      });
    };
    const deadline = setTimeout(() => finish(true), timeoutMs);
    socket.on('data', (data) => {
      firstResponseByteAfterBytes ??= bytesSent;
      response += data.toString('latin1');
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      socketError = error.code ?? error.message;
    });
    socket.on('close', () => finish(false));
    socket.on('end', () => socket.end());
    socket.write(head);
    let index = 0;
    const writeNext = () => {
      if (socket.destroyed || index >= chunks.length) return;
      if (stopWritingOnResponse && firstResponseByteAfterBytes != null) return;
      const chunk = chunks[index];
      index += 1;
      socket.write(chunk, () => {
        bytesSent += chunk.length;
        setTimeout(writeNext, chunkDelayMs);
      });
    };
    writeNext();
  });
}

export function statusOf(response: string): number | null {
  const match = /^HTTP\/1\.1 (\d{3})/.exec(response);
  return match == null ? null : Number(match[1]);
}

export function headerOf(response: string, name: string): string | null {
  const headEnd = response.indexOf('\r\n\r\n');
  const head = headEnd === -1 ? response : response.slice(0, headEnd);
  const pattern = new RegExp(`^${name}:\\s*(.*)$`, 'im');
  return pattern.exec(head)?.[1]?.trim() ?? null;
}

export function jsonBodyOf(response: string): unknown {
  const headEnd = response.indexOf('\r\n\r\n');
  if (headEnd === -1) return null;
  const body = response.slice(headEnd + 4);
  const isChunked = /transfer-encoding:\s*chunked/i.test(
    response.slice(0, headEnd)
  );
  const text = isChunked ? decodeChunked(body) : body;
  return JSON.parse(text);
}

function decodeChunked(body: string): string {
  let rest = body;
  let out = '';
  for (;;) {
    const lineEnd = rest.indexOf('\r\n');
    const size = Number.parseInt(rest.slice(0, lineEnd), 16);
    if (!Number.isFinite(size) || size === 0) return out;
    out += rest.slice(lineEnd + 2, lineEnd + 2 + size);
    rest = rest.slice(lineEnd + 2 + size + 2);
  }
}
