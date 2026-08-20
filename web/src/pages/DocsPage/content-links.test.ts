import { describe, expect, it } from 'vitest';
import { hasDoc } from './loader';

const modules = import.meta.glob('./content/**/*.{md,mdx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const KNOWN_APP_PREFIXES = [
  '/app',
  '/pricing',
  '/debug',
  '/api',
  '/upload',
  '/login',
  '/about',
  '/changelog',
  '/card-options',
  '/print',
  '/status',
];

const LINK_RE = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '');
}

type LinkKind = 'external' | 'anchor' | 'doc' | 'app' | 'relative';

function classify(href: string): LinkKind {
  if (/^(https?:|mailto:)/i.test(href)) return 'external';
  if (href.startsWith('#')) return 'anchor';
  if (href === '/documentation' || href.startsWith('/documentation/')) {
    return 'doc';
  }
  if (href.startsWith('/')) return 'app';
  return 'relative';
}

function slugFromDocHref(href: string): string {
  return href
    .replace(/^\/documentation\//, '')
    .replace(/#.*$/, '')
    .replace(/\?.*$/, '')
    .replace(/\/$/, '');
}

interface FoundLink {
  source: string;
  href: string;
}

const allLinks: FoundLink[] = (() => {
  const out: FoundLink[] = [];
  for (const [path, raw] of Object.entries(modules)) {
    const body = stripCode(raw);
    LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null = LINK_RE.exec(body);
    while (m !== null) {
      out.push({ source: path, href: m[1] });
      m = LINK_RE.exec(body);
    }
  }
  return out;
})();

describe('docs content link integrity', () => {
  it('parses at least one link (sanity)', () => {
    expect(allLinks.length).toBeGreaterThan(0);
  });

  it('every /documentation/... link points to a real page', () => {
    const broken = allLinks.filter((l) => {
      if (classify(l.href) !== 'doc') return false;
      if (l.href === '/documentation') return false;
      return !hasDoc(slugFromDocHref(l.href));
    });
    expect(broken).toEqual([]);
  });

  it('no link starts with /documentation/documentation/', () => {
    const doubled = allLinks.filter((l) =>
      l.href.startsWith('/documentation/documentation/')
    );
    expect(doubled).toEqual([]);
  });

  it('absolute non-docs links target a known app route', () => {
    const unknown = allLinks.filter((l) => {
      if (classify(l.href) !== 'app') return false;
      const path = l.href.split(/[?#]/)[0];
      return !KNOWN_APP_PREFIXES.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`)
      );
    });
    expect(unknown).toEqual([]);
  });

  it('uses absolute paths only — no relative markdown links', () => {
    const relative = allLinks.filter((l) => classify(l.href) === 'relative');
    expect(relative).toEqual([]);
  });
});
