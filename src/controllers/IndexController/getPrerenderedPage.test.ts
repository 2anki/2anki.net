import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  getPrerenderedPage,
  resetPrerenderedPageCacheForTesting,
} from './getPrerenderedPage';

describe('getPrerenderedPage', () => {
  let buildDir: string;

  beforeEach(() => {
    resetPrerenderedPageCacheForTesting();
    buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prerender-'));
    fs.mkdirSync(path.join(buildDir, 'convert', 'pdf-to-anki'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(buildDir, 'convert', 'pdf-to-anki', 'index.html'),
      '<html><title>PDF to Anki</title></html>'
    );
  });

  afterEach(() => {
    fs.rmSync(buildDir, { recursive: true, force: true });
  });

  it.each(['/convert/pdf-to-anki/', '/convert/pdf-to-anki'])(
    'returns the prerendered page for %s',
    (requestPath) => {
      expect(getPrerenderedPage(requestPath, buildDir)).toBe(
        '<html><title>PDF to Anki</title></html>'
      );
    }
  );

  it('returns null for a route with no prerendered page', () => {
    expect(getPrerenderedPage('/upload', buildDir)).toBeNull();
  });

  it.each(['/', '/../etc/passwd', '/convert/../../secret', '/a/%2e%2e', ''])(
    'never reads outside the build for %j',
    (requestPath) => {
      expect(getPrerenderedPage(requestPath, buildDir)).toBeNull();
    }
  );

  it('keeps serving the page it first read while a deploy rebuilds the folder', () => {
    getPrerenderedPage('/convert/pdf-to-anki/', buildDir);
    fs.rmSync(path.join(buildDir, 'convert'), { recursive: true });

    expect(getPrerenderedPage('/convert/pdf-to-anki/', buildDir)).toBe(
      '<html><title>PDF to Anki</title></html>'
    );
  });
});
