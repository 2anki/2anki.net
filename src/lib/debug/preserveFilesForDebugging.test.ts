import { vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import express from 'express';

import { preserveFilesForDebugging } from './preserveFilesForDebugging';
import { UploadedFile } from '../storage/types';

const mockRequest = {
  body: { scope: 'test' },
} as unknown as express.Request;

const makeFile = (overrides: Partial<UploadedFile>): UploadedFile =>
  ({
    fieldname: 'file',
    encoding: '7bit',
    mimetype: 'text/plain',
    size: 0,
    destination: '',
    filename: '',
    buffer: Buffer.alloc(0),
    stream: undefined as unknown as NodeJS.ReadableStream,
    key: '',
    ...overrides,
  }) as UploadedFile;

const findDebugDir = (before: string[]): string | undefined => {
  const entries = fs.readdirSync(path.join(os.tmpdir(), 'debug'));
  return entries.find((name) => !before.includes(name));
};

describe('preserveFilesForDebugging', () => {
  beforeEach(() => {
    const debugBase = path.join(os.tmpdir(), 'debug');
    if (!fs.existsSync(debugBase)) {
      fs.mkdirSync(debugBase, { recursive: true });
    }
  });

  test('skips files with no path or originalname instead of crashing', () => {
    const debugBase = path.join(os.tmpdir(), 'debug');
    const before = fs.readdirSync(debugBase);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const invalidFile = makeFile({
      originalname: undefined as unknown as string,
      path: undefined as unknown as string,
    });

    preserveFilesForDebugging(
      mockRequest,
      [invalidFile],
      new Error('simulated failure')
    );

    expect(errorSpy).not.toHaveBeenCalled();

    const created = findDebugDir(before);
    expect(created).toBeDefined();
    const createdPath = path.join(debugBase, created as string);
    expect(fs.existsSync(path.join(createdPath, 'error.txt'))).toBe(true);
    expect(fs.existsSync(path.join(createdPath, 'request.json'))).toBe(true);

    errorSpy.mockRestore();
    fs.rmSync(createdPath, { recursive: true, force: true });
  });

  test('preserves valid files and skips invalid ones in the same batch', () => {
    const debugBase = path.join(os.tmpdir(), 'debug');
    const before = fs.readdirSync(debugBase);

    const source = path.join(os.tmpdir(), `sample-${Date.now()}.txt`);
    fs.writeFileSync(source, 'sample-bytes');

    const validFile = makeFile({
      originalname: 'sample.txt',
      path: source,
      size: 12,
    });
    const invalidFile = makeFile({
      originalname: undefined as unknown as string,
      path: undefined as unknown as string,
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    preserveFilesForDebugging(
      mockRequest,
      [validFile, invalidFile],
      new Error('simulated failure')
    );

    expect(errorSpy).not.toHaveBeenCalled();

    const created = findDebugDir(before);
    expect(created).toBeDefined();
    const createdPath = path.join(debugBase, created as string);
    expect(fs.existsSync(path.join(createdPath, '0-sample.txt'))).toBe(true);

    errorSpy.mockRestore();
    fs.rmSync(createdPath, { recursive: true, force: true });
    fs.rmSync(source, { force: true });
  });
});
