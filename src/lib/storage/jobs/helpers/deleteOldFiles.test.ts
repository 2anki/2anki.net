import fs from 'fs';
import osReal from 'os';
import pathReal from 'path';
import { randomUUID } from 'crypto';

import deleteOldFiles from './deleteOldFiles';
import { CLEANUP_AGE_SECONDS } from '../../../constants';

// A relative location resolves against os.tmpdir(), so the fixture lives
// directly under it and is referenced by its basename. Absolute locations are
// swept as given; see the last test.
describe('deleteOldFiles', () => {
  let root: string;
  let loc: string;

  const setOld = (target: string) => {
    const old = new Date(Date.now() - (CLEANUP_AGE_SECONDS + 3600) * 1000);
    fs.utimesSync(target, old, old);
  };

  beforeEach(() => {
    loc = `cleanup-fixture-${randomUUID()}`;
    root = pathReal.join(osReal.tmpdir(), loc);
    fs.mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('removes an aged workspace directory but keeps a fresh one', () => {
    const oldDir = pathReal.join(root, 'aaaaaaaa-old-uuid');
    const freshDir = pathReal.join(root, 'bbbbbbbb-fresh-uuid');
    fs.mkdirSync(oldDir);
    fs.mkdirSync(freshDir);
    // Give each directory some content, then backdate the old one's mtime.
    fs.writeFileSync(pathReal.join(oldDir, 'deck.apkg'), 'x');
    fs.writeFileSync(pathReal.join(freshDir, 'deck.apkg'), 'x');
    setOld(oldDir);

    deleteOldFiles([loc]);

    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.existsSync(freshDir)).toBe(true);
  });

  it('removes an aged extensioned file but keeps a fresh one', () => {
    const oldFile = pathReal.join(root, 'stale.zip');
    const freshFile = pathReal.join(root, 'recent.zip');
    fs.writeFileSync(oldFile, 'x');
    fs.writeFileSync(freshFile, 'x');
    setOld(oldFile);

    deleteOldFiles([loc]);

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(freshFile)).toBe(true);
  });

  it('never removes the location root itself', () => {
    setOld(root);

    deleteOldFiles([loc]);

    expect(fs.existsSync(root)).toBe(true);
  });

  // Prod sets WORKSPACE_BASE and UPLOAD_BASE to absolute paths. Joining those
  // onto os.tmpdir() produced a path that does not exist, so the sweep was a
  // no-op on every run (#4568).
  it('sweeps an absolute location as given instead of nesting it under tmpdir', () => {
    const absoluteRoot = fs.mkdtempSync(
      pathReal.join(osReal.tmpdir(), 'cleanup-absolute-')
    );
    const oldDir = pathReal.join(absoluteRoot, 'cccccccc-old-uuid');
    const freshDir = pathReal.join(absoluteRoot, 'dddddddd-fresh-uuid');
    fs.mkdirSync(oldDir);
    fs.mkdirSync(freshDir);
    fs.writeFileSync(pathReal.join(oldDir, 'deck.apkg'), 'x');
    fs.writeFileSync(pathReal.join(freshDir, 'deck.apkg'), 'x');
    setOld(oldDir);

    try {
      deleteOldFiles([absoluteRoot]);

      expect(fs.existsSync(oldDir)).toBe(false);
      expect(fs.existsSync(freshDir)).toBe(true);
      expect(fs.existsSync(absoluteRoot)).toBe(true);
    } finally {
      fs.rmSync(absoluteRoot, { recursive: true, force: true });
    }
  });
});
