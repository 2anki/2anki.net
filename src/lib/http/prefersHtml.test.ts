import type { Request } from 'express';
import { prefersHtml } from './prefersHtml';

const makeRequest = (method: string, accept: string | undefined): Request =>
  ({
    method,
    headers: accept == null ? {} : { accept },
  }) as unknown as Request;

describe('prefersHtml', () => {
  it('is true for a browser navigation that lists text/html', () => {
    const req = makeRequest(
      'GET',
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    );
    expect(prefersHtml(req)).toBe(true);
  });

  it('is false for an API client sending application/json', () => {
    expect(prefersHtml(makeRequest('GET', 'application/json'))).toBe(false);
  });

  it('is false for a wildcard-only Accept header', () => {
    expect(prefersHtml(makeRequest('GET', '*/*'))).toBe(false);
  });

  it('is false when no Accept header is present', () => {
    expect(prefersHtml(makeRequest('GET', undefined))).toBe(false);
  });

  it('is false for a non-GET request even when it would accept html', () => {
    expect(prefersHtml(makeRequest('POST', 'text/html'))).toBe(false);
  });
});
