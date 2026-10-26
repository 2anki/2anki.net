import { InvalidRequestError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

import { assertValidRedirectUris } from './redirectUris';

describe('assertValidRedirectUris', () => {
  it.each([
    [['https://claude.ai/api/mcp/auth_callback']],
    [['http://localhost/callback', 'http://127.0.0.1:3118/callback']],
    [['http://[::1]:8080/callback']],
  ])('accepts %j', (uris) => {
    expect(() => assertValidRedirectUris(uris)).not.toThrow();
  });

  it.each([
    ['none', []],
    ['more than ten', Array.from({ length: 11 }, (_, i) => `https://a.b/${i}`)],
    ['a non-URL', ['not a url']],
    ['a fragment', ['https://claude.ai/cb#frag']],
    ['plain http off loopback', ['http://claude.ai/cb']],
    ['a custom scheme', ['javascript:alert(1)']],
  ])('rejects %s', (_, uris) => {
    expect(() => assertValidRedirectUris(uris)).toThrow(InvalidRequestError);
  });
});
