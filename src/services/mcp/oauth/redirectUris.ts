import { InvalidRequestError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

const MAX_REDIRECT_URIS = 10;

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export function assertValidRedirectUris(uris: string[]): void {
  if (uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    throw new InvalidRequestError('Invalid number of redirect_uris');
  }
  for (const uri of uris) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new InvalidRequestError(`Invalid redirect_uri: ${uri}`);
    }
    if (parsed.hash !== '') {
      throw new InvalidRequestError('redirect_uri must not contain a fragment');
    }
    const isHttps = parsed.protocol === 'https:';
    const isHttpLoopback =
      parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname);
    if (!isHttps && !isHttpLoopback) {
      throw new InvalidRequestError(
        'redirect_uri must use https, or http only for loopback'
      );
    }
  }
}
