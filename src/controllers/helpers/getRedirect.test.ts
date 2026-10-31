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

  describe('should return a connector to the authorize screen after sign in', () => {
    const authorizeUrl =
      '/mcp/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcb&state=s1&code_challenge=abc&code_challenge_method=S256';

    it('keeps the full authorize URL, query included', () => {
      const req = createMockRequest(authorizeUrl);
      expect(getRedirect(req)).toBe(authorizeUrl);
    });

    it('keeps the full authorize URL from the request body', () => {
      const req = createMockRequest(undefined, authorizeUrl);
      expect(getRedirect(req)).toBe(authorizeUrl);
    });

    const lookAlikes = [
      '//evil.com/mcp/authorize?client_id=c1',
      '/\\evil.com/mcp/authorize',
      'https://evil.com/mcp/authorize?client_id=c1',
      '/mcp/authorizeX?client_id=c1',
      '/mcp/authorize/../admin',
    ];
    lookAlikes.forEach((target) => {
      it(`blocks an authorize look-alike: ${JSON.stringify(target)}`, () => {
        const req = createMockRequest(target);
        expect(getRedirect(req)).toBe('/upload');
      });
    });
  });

  describe('should return a pricing visitor to the plan view they left', () => {
    const kept: [string, string][] = [
      ['/pricing?ref=mcp', '/pricing?ref=mcp'],
      ['/pricing/?ref=mcp', '/pricing?ref=mcp'],
      ['/pricing?interval=year', '/pricing?interval=year'],
      ['/pricing?ref=mcp&interval=year', '/pricing?ref=mcp&interval=year'],
      ['/pricing?interval=year&ref=mcp', '/pricing?ref=mcp&interval=year'],
      ['/pricing#auto-sync', '/pricing#auto-sync'],
      ['/pricing?ref=mcp#auto-sync', '/pricing?ref=mcp#auto-sync'],
    ];
    kept.forEach(([input, expected]) => {
      it(`keeps ${input} as ${expected}`, () => {
        expect(getRedirect(createMockRequest(input))).toBe(expected);
      });
    });

    it('reads the pricing return from the request body as well', () => {
      const req = createMockRequest(undefined, '/pricing?ref=mcp');
      expect(getRedirect(req)).toBe('/pricing?ref=mcp');
    });

    const stripped: [string, string][] = [
      ['/pricing?ref=evil', '/pricing'],
      ['/pricing?ref=MCP', '/pricing'],
      ['/pricing?interval=month', '/pricing'],
      ['/pricing?next=https://evil.com', '/pricing'],
      ['/pricing?ref=mcp&next=https://evil.com', '/pricing?ref=mcp'],
      ['/pricing?ref=mcp&ref=evil', '/pricing?ref=mcp'],
      ['/pricing#javascript:alert(1)', '/pricing'],
      ['/pricing?ref=mcp#other', '/pricing?ref=mcp'],
    ];
    stripped.forEach(([input, expected]) => {
      it(`drops anything outside the allowlist: ${input} -> ${expected}`, () => {
        expect(getRedirect(createMockRequest(input))).toBe(expected);
      });
    });

    const offSite: [string, string][] = [
      ['//evil.com/pricing?ref=mcp', '/upload'],
      ['/\\evil.com/pricing?ref=mcp', '/upload'],
      ['https://evil.com/pricing?ref=mcp', '/upload'],
      ['/pricingX?ref=mcp', '/upload'],
      ['/pricing/../admin?ref=mcp', '/pricing'],
    ];
    offSite.forEach(([target, expected]) => {
      it(`keeps no pricing params for a look-alike: ${JSON.stringify(target)}`, () => {
        expect(getRedirect(createMockRequest(target))).toBe(expected);
      });
    });
  });

  describe('should return a visitor to the limit page they signed in from', () => {
    const kept: [string, string][] = [
      ['/limit', '/limit'],
      ['/limit/', '/limit'],
      ['/limit?kind=anonymous', '/limit?kind=anonymous'],
      ['/limit?kind=card_count', '/limit?kind=card_count'],
      ['/limit?kind=file_size', '/limit?kind=file_size'],
      ['/limit?kind=anonymous&cards=240', '/limit?kind=anonymous&cards=240'],
      ['/limit?cards=240&kind=anonymous', '/limit?kind=anonymous&cards=240'],
    ];
    kept.forEach(([input, expected]) => {
      it(`keeps ${input} as ${expected}`, () => {
        expect(getRedirect(createMockRequest(input))).toBe(expected);
      });
    });

    it('reads the limit return from the request body as well', () => {
      const req = createMockRequest(undefined, '/limit?kind=card_count');
      expect(getRedirect(req)).toBe('/limit?kind=card_count');
    });

    const stripped: [string, string][] = [
      ['/limit?kind=evil', '/limit'],
      ['/limit?cards=-1', '/limit'],
      ['/limit?cards=12a', '/limit'],
      ['/limit?cards=1234567', '/limit'],
      ['/limit?ref=limit-wall', '/limit'],
      ['/limit?kind=anonymous&next=https://evil.com', '/limit?kind=anonymous'],
      ['/limit?kind=anonymous&kind=evil', '/limit?kind=anonymous'],
      ['/limit#javascript:alert(1)', '/limit'],
      ['/limit/anything?kind=anonymous', '/limit'],
    ];
    stripped.forEach(([input, expected]) => {
      it(`drops anything outside the allowlist: ${input} -> ${expected}`, () => {
        expect(getRedirect(createMockRequest(input))).toBe(expected);
      });
    });

    const offSite = [
      '//evil.com',
      '//evil.com/limit',
      '/\\evil.com/limit',
      'https://evil.com/limit',
      'https://evil.com/limit?kind=anonymous',
      '/limitless',
      '/limit\r\nLocation: //evil.com',
    ];
    offSite.forEach((target) => {
      it(`refuses a limit look-alike: ${JSON.stringify(target)}`, () => {
        expect(getRedirect(createMockRequest(target))).toBe('/upload');
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
