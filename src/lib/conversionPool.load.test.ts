import os from 'node:os';
import path from 'node:path';
import GeneratePackagesUseCase from '../usecases/uploads/GeneratePackagesUseCase';
import { EmptyDeckError } from '../usecases/jobs/EmptyDeckError';
import CardOption from './parser/Settings/CardOption';
import Workspace from './parser/WorkSpace';
import { UploadedFile } from './storage/types';
import { getConversionPool, shutdownConversionPool } from './conversionPool';

jest.setTimeout(60_000);

const CONCURRENT_JOBS = 10;
const POOL_THREADS = 2;

function makeFile(name: string, contents: string): UploadedFile {
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: contents.length,
    stream: null as never,
    destination: '',
    filename: name,
    path: '',
    buffer: Buffer.from(contents),
    key: name,
  };
}

function noCardHtml(index: number): string {
  return `<html><head><title>empty-${index}</title></head><body></body></html>`;
}

interface JobSpec {
  label: string;
  file: UploadedFile;
  expect: 'empty-deck-error' | 'empty-success' | 'apkg-rejection';
  withProgressChannel: boolean;
}

function buildJobSpecs(): JobSpec[] {
  const specs: JobSpec[] = [];
  for (let i = 0; i < 4; i++) {
    specs.push({
      label: `no-cards-${i}.html`,
      file: makeFile(`no-cards-${i}.html`, noCardHtml(i)),
      expect: 'empty-deck-error',
      withProgressChannel: i === 0,
    });
  }
  for (let i = 0; i < 3; i++) {
    specs.push({
      label: `unsupported-${i}.xyz`,
      file: makeFile(`unsupported-${i}.xyz`, `payload ${i}`),
      expect: 'empty-success',
      withProgressChannel: false,
    });
  }
  for (let i = 0; i < 3; i++) {
    specs.push({
      label: `existing-deck-${i}.apkg`,
      file: makeFile(`existing-deck-${i}.apkg`, `apkg bytes ${i}`),
      expect: 'apkg-rejection',
      withProgressChannel: i === 0,
    });
  }
  return specs;
}

describe('conversion pool under concurrent upload load', () => {
  const previousWorkers = process.env.CONVERSION_WORKERS;
  const previousWorkspaceBase = process.env.WORKSPACE_BASE;
  let errorSpy: jest.SpyInstance;
  let results: PromiseSettledResult<{
    packages: unknown[];
    warnings?: string[];
  }>[];
  let specs: JobSpec[];

  beforeAll(async () => {
    process.env.CONVERSION_WORKERS = String(POOL_THREADS);
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'pool-load-workspaces');
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    specs = buildJobSpecs();
    const useCase = new GeneratePackagesUseCase();
    results = await Promise.allSettled(
      specs.map((spec) =>
        useCase.execute(
          false,
          [spec.file],
          new CardOption({}),
          new Workspace(true, 'fs'),
          spec.withProgressChannel ? () => {} : undefined
        )
      )
    );
  });

  afterAll(async () => {
    await shutdownConversionPool({ timeoutMs: 15_000 });
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('did not drain')
    );
    errorSpy.mockRestore();
    if (previousWorkers === undefined) {
      delete process.env.CONVERSION_WORKERS;
    } else {
      process.env.CONVERSION_WORKERS = previousWorkers;
    }
    if (previousWorkspaceBase === undefined) {
      delete process.env.WORKSPACE_BASE;
    } else {
      process.env.WORKSPACE_BASE = previousWorkspaceBase;
    }
  });

  it('settles every one of the 10 concurrent jobs — none lost', () => {
    expect(results).toHaveLength(CONCURRENT_JOBS);
    for (const result of results) {
      expect(['fulfilled', 'rejected']).toContain(result.status);
    }
  });

  it('queues 10 jobs onto fewer child processes and completes them all', () => {
    const snapshot = getConversionPool().describe();
    expect(snapshot.queueSize).toBe(0);
    expect(snapshot.children).toBeLessThanOrEqual(POOL_THREADS);
  });

  it('rejects each no-card parse with EmptyDeckError across the pool boundary', () => {
    const indices = specs
      .map((spec, i) => (spec.expect === 'empty-deck-error' ? i : -1))
      .filter((i) => i >= 0);
    expect(indices).toHaveLength(4);
    for (const i of indices) {
      const result = results[i];
      expect(result.status).toBe('rejected');
      const reason = (result as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(EmptyDeckError);
    }
  });

  it('resolves each unsupported-type job with an empty package list', () => {
    const indices = specs
      .map((spec, i) => (spec.expect === 'empty-success' ? i : -1))
      .filter((i) => i >= 0);
    expect(indices).toHaveLength(3);
    for (const i of indices) {
      const result = results[i];
      expect(result.status).toBe('fulfilled');
      const value = (result as PromiseFulfilledResult<{ packages: unknown[] }>)
        .value;
      expect(value.packages).toEqual([]);
    }
  });

  it('isolates each apkg rejection to its own job and names the right file', () => {
    const indices = specs
      .map((spec, i) => (spec.expect === 'apkg-rejection' ? i : -1))
      .filter((i) => i >= 0);
    expect(indices).toHaveLength(3);
    for (const i of indices) {
      const result = results[i];
      expect(result.status).toBe('rejected');
      const reason = (result as PromiseRejectedResult).reason as Error;
      expect(reason).toBeInstanceOf(Error);
      expect(reason.message).toContain(specs[i].file.originalname);
    }
  });

  it('keeps failures from leaking into neighbouring successes', () => {
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(7);
  });
});
