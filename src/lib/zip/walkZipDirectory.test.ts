import { strToU8, zipSync } from 'fflate';

import { walkZipDirectory } from './walkZipDirectory';
import { zipDeclaringMoreEntriesThanItHolds } from '../../test/fakes/zipDeclaringMoreEntriesThanItHolds';

function sampleZip(): Buffer {
  return Buffer.from(
    zipSync({
      'a.txt': strToU8('first'),
      'b.txt': strToU8('second entry'),
      'c.txt': strToU8('third'),
    })
  );
}

describe('walkZipDirectory', () => {
  it('visits every entry with its declared sizes', () => {
    const seen: string[] = [];

    const walk = walkZipDirectory(sampleZip(), (entry) => {
      seen.push(`${entry.name}:${entry.originalSize}`);
      return 'continue';
    });

    expect(walk).toBe('complete');
    expect(seen).toEqual(['a.txt:5', 'b.txt:12', 'c.txt:5']);
  });

  it('stops at the entry the caller was looking for', () => {
    const seen: string[] = [];

    const walk = walkZipDirectory(sampleZip(), (entry) => {
      seen.push(entry.name);
      return entry.name === 'b.txt' ? 'stop' : 'continue';
    });

    expect(walk).toBe('stopped');
    expect(seen).toEqual(['a.txt', 'b.txt']);
  });

  it('reads a view of a slice without copying the rest of its buffer', () => {
    const zip = sampleZip();
    const padded = Buffer.concat([Buffer.alloc(7), zip]).subarray(7);
    const seen: string[] = [];

    walkZipDirectory(padded, (entry) => {
      seen.push(entry.name);
      return 'continue';
    });

    expect(seen).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('gives up within milliseconds on a file that declares far more entries than it holds', () => {
    const started = performance.now();

    const walk = walkZipDirectory(
      zipDeclaringMoreEntriesThanItHolds(4_000_000_000),
      () => 'continue'
    );

    expect(walk).toBe('unreadable');
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('calls bytes that are not a zip unreadable', () => {
    expect(walkZipDirectory(Buffer.from('not a zip'), () => 'continue')).toBe(
      'unreadable'
    );
  });
});
