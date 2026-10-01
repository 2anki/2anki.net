import { describe, expect, it } from 'vitest';
import type UserUpload from '../../../../../lib/interfaces/UserUpload';
import { findRecoveredUpload } from './findRecoveredUpload';

function upload(overrides: Partial<UserUpload>): UserUpload {
  return {
    id: '1',
    size_mb: 1,
    owner: 1,
    key: 'key-1',
    filename: 'biochem',
    object_id: 'obj-1',
    created_at: null,
    source: null,
    ...overrides,
  };
}

const SUBMITTED = Date.parse('2026-10-01T12:00:00.000Z');

describe('findRecoveredUpload', () => {
  it('returns a deck created after the upload started that matches the file name', () => {
    const match = upload({
      key: 'fresh',
      filename: 'biochem',
      created_at: '2026-10-01T12:01:10.000Z',
    });
    const result = findRecoveredUpload(
      [
        upload({
          key: 'old',
          filename: 'anatomy',
          created_at: '2026-09-30T09:00:00.000Z',
        }),
        match,
      ],
      'biochem.pdf',
      SUBMITTED
    );
    expect(result?.key).toBe('fresh');
  });

  it('ignores decks created before the upload started', () => {
    const result = findRecoveredUpload(
      [
        upload({
          key: 'stale',
          filename: 'biochem',
          created_at: '2026-10-01T11:30:00.000Z',
        }),
      ],
      'biochem.pdf',
      SUBMITTED
    );
    expect(result).toBeNull();
  });

  it('tolerates minor clock skew within the buffer window', () => {
    const result = findRecoveredUpload(
      [
        upload({
          key: 'skewed',
          filename: 'biochem',
          created_at: '2026-10-01T11:59:30.000Z',
        }),
      ],
      'biochem.pdf',
      SUBMITTED
    );
    expect(result?.key).toBe('skewed');
  });

  it('returns null when no recent deck name relates to the uploaded file', () => {
    const result = findRecoveredUpload(
      [
        upload({
          key: 'unrelated',
          filename: 'pharmacology',
          created_at: '2026-10-01T12:00:30.000Z',
        }),
      ],
      'biochem.pdf',
      SUBMITTED
    );
    expect(result).toBeNull();
  });

  it('picks the newest matching deck when several match', () => {
    const result = findRecoveredUpload(
      [
        upload({
          key: 'earlier',
          filename: 'biochem',
          created_at: '2026-10-01T12:00:05.000Z',
        }),
        upload({
          key: 'latest',
          filename: 'biochem notes',
          created_at: '2026-10-01T12:02:00.000Z',
        }),
      ],
      'biochem.pdf',
      SUBMITTED
    );
    expect(result?.key).toBe('latest');
  });

  it('returns null for uploads without a created_at timestamp', () => {
    const result = findRecoveredUpload(
      [upload({ key: 'no-time', filename: 'biochem', created_at: null })],
      'biochem.pdf',
      SUBMITTED
    );
    expect(result).toBeNull();
  });
});
