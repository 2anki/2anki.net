import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  getIndexFileContents,
  resetIndexFileCacheForTesting,
} from './getIndexFileContents';
import { BUILD_DIR } from '../../lib/constants';

vi.mock('../../lib/constants', () => {
  const tmpRoot = os.tmpdir();
  const tmpBuild = path.join(
    tmpRoot,
    `index-contents-test-${process.pid}-${Date.now()}`
  );
  return { BUILD_DIR: tmpBuild };
});

describe('getIndexFileContents', () => {
  beforeEach(() => {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
    resetIndexFileCacheForTesting();
  });

  const writeIndex = (html: string) => {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), html, 'utf8');
  };

  afterAll(() => {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  });

  it('returns the file contents when index.html exists', () => {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(BUILD_DIR, 'index.html'),
      '<html>hello</html>',
      'utf8'
    );

    expect(getIndexFileContents()).toBe('<html>hello</html>');
  });

  it('returns null when index.html is missing (deploy race)', () => {
    expect(getIndexFileContents()).toBeNull();
  });

  it('keeps serving the index it loaded while a deploy rebuilds the directory', () => {
    writeIndex('<html>live build</html>');
    expect(getIndexFileContents()).toBe('<html>live build</html>');

    fs.rmSync(BUILD_DIR, { recursive: true, force: true });

    expect(getIndexFileContents()).toBe('<html>live build</html>');
  });

  it('serves the index matching its own build after a newer one lands on disk', () => {
    writeIndex('<html>live build</html>');
    getIndexFileContents();

    writeIndex('<html>next build</html>');

    expect(getIndexFileContents()).toBe('<html>live build</html>');
  });

  it('picks the index up once it appears after starting without one', () => {
    expect(getIndexFileContents()).toBeNull();

    writeIndex('<html>first build</html>');

    expect(getIndexFileContents()).toBe('<html>first build</html>');
  });

  it('returns null when build directory itself is missing', () => {
    expect(fs.existsSync(BUILD_DIR)).toBe(false);
    expect(getIndexFileContents()).toBeNull();
  });
});
