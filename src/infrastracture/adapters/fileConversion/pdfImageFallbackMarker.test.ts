import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CONVERSION_FALLBACK_FILENAME,
  writePdfImageFallbackMarker,
  loadPdfImageFallbackNames,
  matchesPdfImageFallback,
} from './pdfImageFallbackMarker';

describe('pdfImageFallbackMarker', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fallback-marker-'));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('writes the fallback names as a JSON array and reads them back', () => {
    writePdfImageFallbackMarker(workspaceDir, [
      'scan.pdf.html',
      'notes/second.pdf.html',
    ]);

    const written = JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, CONVERSION_FALLBACK_FILENAME),
        'utf8'
      )
    );
    expect(written).toEqual(['scan.pdf.html', 'notes/second.pdf.html']);
    expect(loadPdfImageFallbackNames(workspaceDir)).toEqual(
      new Set(['scan.pdf.html', 'notes/second.pdf.html'])
    );
  });

  it('does not write a marker when there are no fallback names', () => {
    writePdfImageFallbackMarker(workspaceDir, []);

    expect(
      fs.existsSync(path.join(workspaceDir, CONVERSION_FALLBACK_FILENAME))
    ).toBe(false);
  });

  it('returns an empty set when the marker is missing', () => {
    expect(loadPdfImageFallbackNames(workspaceDir)).toEqual(new Set());
  });

  it('returns an empty set when the marker is corrupt', () => {
    fs.writeFileSync(
      path.join(workspaceDir, CONVERSION_FALLBACK_FILENAME),
      'not json {'
    );

    expect(loadPdfImageFallbackNames(workspaceDir)).toEqual(new Set());
  });

  it('returns an empty set when the marker is not a JSON array', () => {
    fs.writeFileSync(
      path.join(workspaceDir, CONVERSION_FALLBACK_FILENAME),
      JSON.stringify({ scan: true })
    );

    expect(loadPdfImageFallbackNames(workspaceDir)).toEqual(new Set());
  });

  it('matches an html file by its basename against the marker set', () => {
    const names = new Set(['scan.pdf.html']);

    expect(
      matchesPdfImageFallback(
        path.join(workspaceDir, 'scan.pdf.html'),
        workspaceDir,
        names
      )
    ).toBe(true);
  });

  it('matches an html file by its workspace-relative path', () => {
    const names = new Set(['notes/second.pdf.html']);

    expect(
      matchesPdfImageFallback(
        path.join(workspaceDir, 'notes', 'second.pdf.html'),
        workspaceDir,
        names
      )
    ).toBe(true);
  });

  it('does not match an html file that is not in the marker set', () => {
    const names = new Set(['scan.pdf.html']);

    expect(
      matchesPdfImageFallback(
        path.join(workspaceDir, 'page.html'),
        workspaceDir,
        names
      )
    ).toBe(false);
  });

  it('never matches when the marker set is empty', () => {
    expect(
      matchesPdfImageFallback(
        path.join(workspaceDir, 'scan.pdf.html'),
        workspaceDir,
        new Set()
      )
    ).toBe(false);
  });
});
