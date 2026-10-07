import { vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { zipSync } from 'fflate';
import { setupTests } from '../../../test/configure-jest';
import { embedFile } from './embedFile';
import CustomExporter from './CustomExporter';
import Workspace from '../WorkSpace';
import { ZipHandler } from '../../zip/zip';
import CardOption from '../Settings';

beforeEach(() => setupTests());

const makeExporter = (firstDeckName = 'deck') =>
  ({
    firstDeckName,
    workspace: '/tmp',
    media: [],
    addMedia: vi.fn().mockReturnValue('/tmp/mock.png'),
  }) as unknown as CustomExporter;

const makeWorkspace = () =>
  ({ location: '/nonexistent-workspace-xyzzy' }) as unknown as Workspace;

describe('embedFile — filename-only fallback', () => {
  it('returns the single matching file when there is no collision', () => {
    const exporter = makeExporter();
    const file = { name: 'chapter1/image.png', contents: 'img-data' };

    const result = embedFile({
      exporter,
      files: [file],
      filePath: 'chapter1/sub/image.png',
      workspace: makeWorkspace(),
    });

    expect(result).not.toBeNull();
    expect(exporter.addMedia).toHaveBeenCalledWith(
      expect.any(String),
      'img-data'
    );
  });

  it('picks the file whose directory shares the most path segments with the request', () => {
    const exporter = makeExporter();
    const chapter1 = { name: 'chapter1/image.png', contents: 'chapter1-data' };
    const chapter2 = { name: 'chapter2/image.png', contents: 'chapter2-data' };

    embedFile({
      exporter,
      files: [chapter1, chapter2],
      // Does not suffix-match either file, so filename-only fallback is used.
      // requestDir = 'chapter2/sub' → chapter2 scores 1 shared segment, chapter1 scores 0.
      filePath: 'chapter2/sub/image.png',
      workspace: makeWorkspace(),
    });

    expect(exporter.addMedia).toHaveBeenCalledWith(
      expect.any(String),
      chapter2.contents
    );
  });

  it('falls back to first match when all colliding files score equally', () => {
    const exporter = makeExporter();
    const fileA = { name: 'a/image.png', contents: 'file-a' };
    const fileB = { name: 'b/image.png', contents: 'file-b' };

    // filePath has no directory, so requestDir is '' and both score 0.
    embedFile({
      exporter,
      files: [fileA, fileB],
      filePath: 'image.png',
      workspace: makeWorkspace(),
    });

    expect(exporter.addMedia).toHaveBeenCalledWith(
      expect.any(String),
      fileA.contents
    );
  });

  it('returns null when no file matches', () => {
    const exporter = makeExporter();
    const result = embedFile({
      exporter,
      files: [{ name: 'other/thing.png', contents: 'data' }],
      filePath: 'missing.png',
      workspace: makeWorkspace(),
    });

    expect(result).toBeNull();
  });

  it('does not append the literal "null" for extensionless files', () => {
    const exporter = makeExporter();
    const result = embedFile({
      exporter,
      files: [{ name: 'attachment', contents: 'binary-data' }],
      filePath: 'attachment',
      workspace: makeWorkspace(),
    });

    expect(result).not.toBeNull();
    expect(result).not.toMatch(/null$/);
    expect(exporter.addMedia).toHaveBeenCalledWith(
      expect.any(String),
      'binary-data'
    );
  });

  it('returns null without referencing media when contents are empty', () => {
    const exporter = makeExporter();
    const result = embedFile({
      exporter,
      files: [{ name: 'image.png', contents: '' }],
      filePath: 'image.png',
      workspace: makeWorkspace(),
    });

    expect(result).toBeNull();
    expect(exporter.addMedia).not.toHaveBeenCalled();
  });
});

describe('embedFile — disk-backed (spilled) zip entries', () => {
  it('resolves a spilled image lazily from disk and embeds its real bytes', async () => {
    const spill = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-spill-'));
    const imageBytes = Buffer.alloc(64, 7);
    const zip = zipSync(
      { 'chapter1/image.png': new Uint8Array(imageBytes) },
      { level: 0 }
    );

    const handler = new ZipHandler(10);
    await handler.build(zip, true, new CardOption({}), spill);

    // The bytes are on disk; the in-memory entry reads them lazily.
    expect(fs.existsSync(path.join(spill, 'chapter1/image.png'))).toBe(true);

    const captured: Buffer[] = [];
    const exporter = {
      firstDeckName: 'deck',
      workspace: '/tmp',
      media: [],
      addMedia: vi.fn((_name: string, contents: Buffer) => {
        captured.push(Buffer.from(contents));
        return '/tmp/x.png';
      }),
    } as unknown as CustomExporter;

    const result = embedFile({
      exporter,
      files: handler.files,
      filePath: 'chapter1/image.png',
      // A location that does not exist so getFile falls through to the
      // in-memory (now disk-backed) entry, exercising the lazy read.
      workspace: {
        location: '/nonexistent-workspace-xyzzy',
      } as unknown as Workspace,
    });

    expect(result).not.toBeNull();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(imageBytes);
  });
});
