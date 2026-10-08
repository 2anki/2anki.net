import { describe, expect, it } from 'vitest';

import { isHeavyUploader } from './producerUploadGate';
import UserUpload from '../../../lib/interfaces/UserUpload';

const NOW = new Date('2026-06-25T12:00:00Z').getTime();

function makeUploads(count: number, daysAgo: number): UserUpload[] {
  const created = new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return Array.from({ length: count }, (_, i) => ({
    id: `u${i}`,
    size_mb: 1,
    owner: 1,
    key: `k${i}`,
    filename: `f${i}.apkg`,
    object_id: `o${i}`,
    created_at: created,
    source: 'upload',
    dropped_image_count: null,
    image_drop_reason: null,
  }));
}

describe('isHeavyUploader', () => {
  it('is true at 21 uploads within 90 days', () => {
    expect(isHeavyUploader(makeUploads(21, 10), NOW)).toBe(true);
  });

  it('is false at 20 uploads within 90 days', () => {
    expect(isHeavyUploader(makeUploads(20, 10), NOW)).toBe(false);
  });

  it('excludes uploads older than 90 days from the count', () => {
    const recent = makeUploads(20, 10);
    const old = makeUploads(5, 120);
    expect(isHeavyUploader([...recent, ...old], NOW)).toBe(false);
  });

  it('ignores uploads with no created_at', () => {
    const withDates = makeUploads(20, 10);
    const undated = makeUploads(5, 10).map((u) => ({
      ...u,
      created_at: null,
    }));
    expect(isHeavyUploader([...withDates, ...undated], NOW)).toBe(false);
  });
});
