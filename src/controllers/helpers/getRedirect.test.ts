import { Request } from 'express';
import { getRedirect } from './getRedirect';

const createMockRequest = (
  redirectParam?: string,
  bodyRedirect?: string
): Request => {
  return {
    query: redirectParam ? { redirect: redirectParam } : {},
    body: bodyRedirect ? { redirect: bodyRedirect } : {},
  } as Request;
};

describe('getRedirect security tests', () => {
  describe('should return safe default for missing redirect', () => {
    it('should return /upload when no redirect param', () => {
      const req = createMockRequest();
      expect(getRedirect(req)).toBe('/upload');
    });

    it('should return /upload when redirect param is undefined', () => {
      const req = createMockRequest(undefined);
      expect(getRedirect(req)).toBe('/upload');
    });
  });

  describe('should allow valid internal paths', () => {
    const validPaths = [
      '/notion',
      '/search',
      '/upload',
      '/downloads',
      '/favorites',
      '/templates',
      '/pricing',
      '/settings',
      '/anki',
      '/card-options',
    ];

    validPaths.forEach((path) => {
      it(`should allow valid internal path: ${path}`, () => {
        const req = createMockRequest(path);
        expect(getRedirect(req)).toBe(path);
      });
    });
  });

  describe('should collapse subpaths to their allowlisted section root', () => {
    const subpaths: [string, string][] = [
      ['/search/results', '/search'],
      ['/templates/new', '/templates'],
      ['/notion/some-page-id', '/notion'],
      ['/notion/../../etc/passwd', '/notion'],
    ];

    subpaths.forEach(([input, expected]) => {
      it(`collapses ${input} to ${expected}`, () => {
        const req = createMockRequest(input);
        expect(getRedirect(req)).toBe(expected);
      });
    });
  });

  describe('should block malicious redirects', () => {
    const maliciousUrls = [
      'http://evil.com',
      'https://evil.com',
      'https://malicious.example.com',
      'https://2anki.net.evil.com',
      'https://app.2anki.net.attacker.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.com',
      '/\\evil.com',
      'https://phishing-site.com',
    ];

    maliciousUrls.forEach((url) => {
      it(`should block malicious URL: ${url}`, () => {
        const req = createMockRequest(url);
        expect(getRedirect(req)).toBe('/upload');
      });
    });
  });

  describe('should allow legitimate external domains', () => {
    const legitimateUrls = [
      'https://2anki.net',
      'https://app.2anki.net',
      'https://notion.2anki.net',
      'https://staging.2anki.net',
      'https://templates.2anki.net',
    ];

    legitimateUrls.forEach((url) => {
      it(`should allow legitimate domain: ${url}`, () => {
        const req = createMockRequest(url);
        expect(getRedirect(req)).toBe(url);
      });
    });
  });

  describe('should block invalid paths', () => {
    const invalidPaths = [
      '/admin',
      '/config',
      '/secret',
      '/api/internal',
      '/../../etc/passwd',
      '/malicious',
    ];

    invalidPaths.forEach((path) => {
      it(`should block invalid internal path: ${path}`, () => {
        const req = createMockRequest(path);
        expect(getRedirect(req)).toBe('/upload');
      });
    });
  });

  describe('should handle edge cases', () => {
    it('should block empty string', () => {
      const req = createMockRequest('');
      expect(getRedirect(req)).toBe('/upload');
    });

    it('should block invalid URL formats', () => {
      const req = createMockRequest('not-a-url');
      expect(getRedirect(req)).toBe('/upload');
    });

    it('should block non-HTTPS external URLs (except localhost)', () => {
      const req = createMockRequest('http://2anki.net');
      expect(getRedirect(req)).toBe('/upload');
    });
  });

  describe('should carry the deck-ready download link through sign in', () => {
    it('keeps the full download path so the email link survives login', () => {
      const req = createMockRequest('/api/download/u/owner-1234-uuid.apkg');
      expect(getRedirect(req)).toBe('/api/download/u/owner-1234-uuid.apkg');
    });

    it('reads the download path from the request body as well', () => {
      const req = createMockRequest(
        undefined,
        '/api/download/u/owner-1234-uuid.apkg'
      );
      expect(getRedirect(req)).toBe('/api/download/u/owner-1234-uuid.apkg');
    });

    const unsafeDownloadTargets = [
      '/api/download/u/../../../admin',
      '/api/download/u/..',
      '/api/download/u/%2e%2e',
      '/api/download/u/%2F%2F',
      '/api/download/u/deck.apkg?next=/admin',
      '/api/download/u/deck.apkg#/admin',
      '/api/download/u/..\\evil',
      '/api/download/u/deck\r\nSet-Cookie: x=1',
      '/api/download/u/deck\nLocation: //evil.com',
      'https://evil.com/api/download/u/x',
    ];
    unsafeDownloadTargets.forEach((target) => {
      it(`blocks an unsafe download target: ${JSON.stringify(target)}`, () => {
        const req = createMockRequest(target);
        expect(getRedirect(req)).toBe('/upload');
      });
    });

    const offSiteTargets = ['/\\evil', '//evil', '/\r\n/evil'];
    offSiteTargets.forEach((target) => {
      it(`blocks an off-site target: ${JSON.stringify(target)}`, () => {
        const req = createMockRequest(target);
        expect(getRedirect(req)).toBe('/upload');
      });
    });
  });

  describe('should read redirect from request body as fallback', () => {
    it('returns body redirect when query param is absent', () => {
      const req = createMockRequest(undefined, '/card-options');
      expect(getRedirect(req)).toBe('/card-options');
    });

    it('prefers query param over body when both present', () => {
      const req = createMockRequest('/upload', '/card-options');
      expect(getRedirect(req)).toBe('/upload');
    });

    it('blocks invalid body redirect', () => {
      const req = createMockRequest(undefined, '//evil.com');
      expect(getRedirect(req)).toBe('/upload');
    });

    it('blocks javascript: scheme in body redirect', () => {
      const req = createMockRequest(undefined, 'javascript:alert(1)');
      expect(getRedirect(req)).toBe('/upload');
    });
  });
});
