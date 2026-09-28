import fs from 'node:fs';
import osReal from 'node:os';
import pathReal from 'node:path';
import { randomUUID } from 'node:crypto';

import deleteOldFiles from './deleteOldFiles';
import { CLEANUP_AGE_SECONDS } from '../../../constants';

// A relative location resolves against os.tmpdir(), so the fixture lives
// directly under it and is referenced by its basename. Absolute locations are
// swept as given.
describe('deleteOldFiles', () => {
  let root: string;
  let loc: string;
  let info: jest.SpyInstance;

  const OLD = new Date(Date.now() - (CLEANUP_AGE_SECONDS + 3600) * 1000);

  const setOld = (target: string) => {
    fs.lutimesSync(target, OLD, OLD);
  };

  beforeEach(() => {
    loc = `cleanup-fixture-${randomUUID()}`;
    root = pathReal.join(osReal.tmpdir(), loc);
    fs.mkdirSync(root, { recursive: true });
    info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    info.mockRestore();
  });

  it('removes an aged workspace directory but keeps a fresh one', () => {
    const oldDir = pathReal.join(root, 'aaaaaaaa-old-uuid');
    const freshDir = pathReal.join(root, 'bbbbbbbb-fresh-uuid');
    fs.mkdirSync(oldDir);
    fs.mkdirSync(freshDir);
    fs.writeFileSync(pathReal.join(oldDir, 'deck.apkg'), 'x');
    fs.writeFileSync(pathReal.join(freshDir, 'deck.apkg'), 'x');
    setOld(oldDir);

    deleteOldFiles([loc]);

    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.existsSync(freshDir)).toBe(true);
  });

  it('removes an aged file, extensioned or not, but keeps a fresh one', () => {
    const oldFile = pathReal.join(root, 'stale.zip');
    const oldTempFile = pathReal.join(root, '0f4752d311ce8a8cc5f95722e2985fd8');
    const freshFile = pathReal.join(root, 'recent.zip');
    fs.writeFileSync(oldFile, 'x');
    fs.writeFileSync(oldTempFile, 'x');
    fs.writeFileSync(freshFile, 'x');
    setOld(oldFile);
    setOld(oldTempFile);

    deleteOldFiles([loc]);

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(oldTempFile)).toBe(false);
    expect(fs.existsSync(freshFile)).toBe(true);
  });

  it('never removes the location root itself', () => {
    setOld(root);

    deleteOldFiles([loc]);

    expect(fs.existsSync(root)).toBe(true);
  });

  it('leaves a fresh workspace alone even when files inside it carry old mtimes', () => {
    const freshDir = pathReal.join(root, 'eeeeeeee-fresh-uuid');
    const extracted = pathReal.join(freshDir, 'page.html');
    fs.mkdirSync(freshDir);
    fs.writeFileSync(extracted, 'x');
    setOld(extracted);

    deleteOldFiles([loc]);

    expect(fs.existsSync(extracted)).toBe(true);
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

  // bsdtar extracts a zip's symlink entries as real links inside the
  // workspace, so an uploaded archive can point a workspace entry anywhere.
  it('removes an aged workspace containing a symlink without touching the link target', () => {
    const outside = fs.mkdtempSync(
      pathReal.join(osReal.tmpdir(), 'cleanup-outside-')
    );
    const outsideFile = pathReal.join(outside, 'secret.env');
    fs.writeFileSync(outsideFile, 'x');
    setOld(outsideFile);
    const oldDir = pathReal.join(root, 'ffffffff-old-uuid');
    fs.mkdirSync(oldDir);
    fs.symlinkSync(outside, pathReal.join(oldDir, 'evil'));
    setOld(oldDir);

    try {
      deleteOldFiles([loc]);

      expect(fs.existsSync(oldDir)).toBe(false);
      expect(fs.existsSync(outsideFile)).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('unlinks an aged top-level symlink without following it', () => {
    const outside = fs.mkdtempSync(
      pathReal.join(osReal.tmpdir(), 'cleanup-outside-')
    );
    const outsideFile = pathReal.join(outside, 'secret.env');
    fs.writeFileSync(outsideFile, 'x');
    setOld(outsideFile);
    const link = pathReal.join(root, 'evil');
    fs.symlinkSync(outside, link);
    setOld(link);

    try {
      deleteOldFiles([loc]);

      expect(fs.lstatSync.bind(fs, link)).toThrow();
      expect(fs.existsSync(outsideFile)).toBe(true);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('skips a location that does not exist', () => {
    expect(() => deleteOldFiles([`${loc}-missing`])).not.toThrow();
    expect(info).not.toHaveBeenCalled();
  });

  it('reports how many entries it scanned and removed', () => {
    const oldFile = pathReal.join(root, 'stale.zip');
    fs.writeFileSync(oldFile, 'x');
    fs.writeFileSync(pathReal.join(root, 'recent.zip'), 'x');
    setOld(oldFile);

    deleteOldFiles([loc]);

    expect(info).toHaveBeenCalledWith(
      '[cleanup] swept old files',
      expect.objectContaining({ root, scanned: 2, removed: 1, failed: 0 })
    );
  });
});
