import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  injectLegalDocument,
  legalPrerenderFor,
  renderLegalDocument,
} from './legalPrerender';

const SHELL =
  '<html><head><title>Convert Notion to Anki — 2anki.net</title></head><body><noscript>x</noscript><div id="root"></div></body></html>';

const PRIVACY_MD = `---
title: 'Privacy Policy'
description: 'Privacy policy for 2anki.net'
---

Questions go to [support@2anki.net](mailto:support@2anki.net).

## Signing in with Google

We read your email address.
`;

describe('renderLegalDocument', () => {
  it('strips the frontmatter, keeps the title, and renders the body', () => {
    const doc = renderLegalDocument(PRIVACY_MD);
    expect(doc.title).toBe('Privacy Policy');
    expect(doc.html).toContain('<h2>Signing in with Google</h2>');
    expect(doc.html).toContain('<p>We read your email address.</p>');
    expect(doc.html).not.toContain('description:');
  });

  it('renders a document without frontmatter as an untitled body', () => {
    const doc = renderLegalDocument('Plain **text**.');
    expect(doc).toEqual({
      title: '',
      html: '<p>Plain <strong>text</strong>.</p>\n',
    });
  });
});

describe('injectLegalDocument', () => {
  it('puts the rendered policy inside the React root and sets the title', () => {
    const html = injectLegalDocument(SHELL, renderLegalDocument(PRIVACY_MD));
    expect(html).toContain('<title>Privacy Policy — 2anki</title>');
    expect(html).toContain('<div id="root"><main class="legal-prerender"');
    expect(html).toContain('<h1>Privacy Policy</h1>');
    expect(html).toContain('<h2>Signing in with Google</h2>');
    expect(html).toContain('</main></div>');
  });
});

describe('legalPrerenderFor', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-prerender-'));
    fs.writeFileSync(path.join(dir, 'privacy.md'), PRIVACY_MD);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('renders the privacy route from the content directory', () => {
    const html = legalPrerenderFor(
      '/documentation/misc/privacy-policy',
      SHELL,
      dir
    );
    expect(html).toContain('<h2>Signing in with Google</h2>');
  });

  it('returns null for a route that is not a legal page', () => {
    expect(legalPrerenderFor('/upload', SHELL, dir)).toBeNull();
  });

  it.each(['/constructor', '/__proto__', 'constructor', '__proto__'])(
    'treats prototype-shaped path %s as no legal page',
    (routePath) => {
      expect(legalPrerenderFor(routePath, SHELL, dir)).toBeNull();
    }
  );

  it('returns null when the policy file is missing so the plain shell is served', () => {
    expect(
      legalPrerenderFor('/documentation/misc/terms-of-service', SHELL, dir)
    ).toBeNull();
  });
});
