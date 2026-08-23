import { describe, expect, it } from 'vitest';

import JobResponse from '../../../schemas/public/JobResponse';
import UserUpload from '../../../lib/interfaces/UserUpload';
import { DropboxUpload, GoogleDriveUpload } from '../../../lib/backend';
import { toDeckRows } from './toDeckRows';
import { JobsId } from '../../../schemas/public/Jobs';

const makeJob = (overrides: Partial<JobResponse> = {}): JobResponse => ({
  id: 1 as JobsId,
  owner: 'user-1',
  object_id: 'obj-1',
  status: 'done',
  created_at: new Date('2026-05-10T10:00:00Z'),
  last_edited_time: new Date('2026-05-10T10:00:00Z'),
  title: 'Test Deck',
  type: 'page',
  job_reason_failure: null,
  card_count: null,
  restartable: false,
  download_key: null,
  upload_id: null,
  ...overrides,
});

const makeUpload = (overrides: Partial<UserUpload> = {}): UserUpload => ({
  id: 'upload-1',
  size_mb: 1,
  owner: 1,
  key: 'key-1',
  filename: 'deck.apkg',
  object_id: 'obj-upload-1',
  created_at: '2026-05-10T09:00:00Z',
  source: null,
  ...overrides,
});

const makeDropboxUpload = (
  overrides: Partial<DropboxUpload> = {}
): DropboxUpload => ({
  id: 10,
  bytes: 1024,
  name: 'notes.html',
  created_at: '2026-05-09T08:00:00Z',
  ...overrides,
});

const makeGoogleDriveUpload = (
  overrides: Partial<GoogleDriveUpload> = {}
): GoogleDriveUpload => ({
  id: 'gdrive-1',
  iconUrl: 'https://ssl.gstatic.com/icon.png',
  mimeType: 'text/html',
  name: 'study.html',
  sizeBytes: '2048',
  url: 'https://drive.google.com/file/d/abc',
  last_converted_at: '2026-05-08T07:00:00Z',
  ...overrides,
});

describe('toDeckRows — source mapping', () => {
  it('maps job.type === "page" to source: notion', () => {
    const rows = toDeckRows([makeJob({ type: 'page' })], [], [], []);
    expect(rows[0].source).toBe('notion');
  });

  it('maps job.type === "database" to source: notion', () => {
    const rows = toDeckRows([makeJob({ type: 'database' })], [], [], []);
    expect(rows[0].source).toBe('notion');
  });

  it('maps job.type === "conversion" to source: notion', () => {
    const rows = toDeckRows([makeJob({ type: 'conversion' })], [], [], []);
    expect(rows[0].source).toBe('notion');
  });

  it('maps job.type === "claude" to source: upload', () => {
    const rows = toDeckRows([makeJob({ type: 'claude' })], [], [], []);
    expect(rows[0].source).toBe('upload');
  });

  it('maps job.type === "mcp" to source: mcp', () => {
    const rows = toDeckRows([makeJob({ type: 'mcp' })], [], [], []);
    expect(rows[0].source).toBe('mcp');
  });

  it('maps unknown job.type to source: upload', () => {
    const rows = toDeckRows([makeJob({ type: 'apkg_import' })], [], [], []);
    expect(rows[0].source).toBe('upload');
  });

  it('maps UserUpload to source: upload, kind: file', () => {
    const rows = toDeckRows([], [makeUpload()], [], []);
    expect(rows[0]).toMatchObject({ source: 'upload', kind: 'file' });
  });

  it('maps a UserUpload with source "app" to source: app, kind: file', () => {
    const rows = toDeckRows([], [makeUpload({ source: 'app' })], [], []);
    expect(rows[0]).toMatchObject({ source: 'app', kind: 'file' });
  });

  it('maps DropboxUpload to source: dropbox, kind: dropbox', () => {
    const rows = toDeckRows([], [], [makeDropboxUpload()], []);
    expect(rows[0]).toMatchObject({ source: 'dropbox', kind: 'dropbox' });
  });

  it('maps GoogleDriveUpload to source: drive, kind: drive', () => {
    const rows = toDeckRows([], [], [], [makeGoogleDriveUpload()]);
    expect(rows[0]).toMatchObject({ source: 'drive', kind: 'drive' });
  });
});

describe('toDeckRows — sorting', () => {
  it('sorts merged rows by sortKey descending (newest first)', () => {
    const olderJob = makeJob({
      id: 1 as JobsId,
      created_at: new Date('2026-05-08T00:00:00Z'),
    });
    const newerJob = makeJob({
      id: 2 as JobsId,
      created_at: new Date('2026-05-10T00:00:00Z'),
    });
    const rows = toDeckRows([olderJob, newerJob], [], [], []);
    expect(rows[0].sortKey.getTime()).toBeGreaterThan(
      rows[1].sortKey.getTime()
    );
  });

  it('places null created_at at the end', () => {
    const jobWithDate = makeJob({
      id: 1 as JobsId,
      created_at: new Date('2026-05-10T00:00:00Z'),
    });
    const jobNoDate = makeJob({ id: 2 as JobsId, created_at: null });
    const rows = toDeckRows([jobNoDate, jobWithDate], [], [], []);
    expect(
      (
        rows[0] as {
          source: string;
          kind: string;
          job: JobResponse;
          sortKey: Date;
        }
      ).job.id
    ).toBe(1);
  });

  it('handles created_at when API returns it as an ISO string (not a Date)', () => {
    const isoString = '2026-05-10T00:00:00.000Z';
    const job = makeJob({
      id: 1 as JobsId,
      created_at: isoString as unknown as Date,
    });
    const rows = toDeckRows([job], [], [], []);
    expect(rows[0].sortKey).toBeInstanceOf(Date);
    expect(rows[0].sortKey.getTime()).toBe(new Date(isoString).getTime());
  });
});

describe('toDeckRows — Notion job dedupe', () => {
  it('suppresses the file row when a done Notion job has a matching download_key for the same object_id', () => {
    const notionJob = makeJob({
      id: 1 as JobsId,
      type: 'page',
      status: 'done',
      object_id: 'notion-page-uuid',
      download_key: 'deck-abc123.apkg',
      upload_id: 42,
    });
    const matchingUpload = makeUpload({
      object_id: 'notion-page-uuid',
      key: 'deck-abc123.apkg',
    });
    const rows = toDeckRows([notionJob], [matchingUpload], [], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('job');
    expect(rows[0].source).toBe('notion');
  });

  it('keeps the file row when the Notion job is not done', () => {
    const notionJob = makeJob({
      id: 1 as JobsId,
      type: 'page',
      status: 'started',
      object_id: 'notion-page-uuid',
      download_key: null,
      upload_id: null,
    });
    const upload = makeUpload({ object_id: 'notion-page-uuid' });
    const rows = toDeckRows([notionJob], [upload], [], []);
    expect(rows).toHaveLength(2);
  });

  it('keeps the file row when download_key is null even if Notion job is done', () => {
    const notionJob = makeJob({
      id: 1 as JobsId,
      type: 'page',
      status: 'done',
      object_id: 'notion-page-uuid',
      download_key: null,
      upload_id: null,
    });
    const upload = makeUpload({ object_id: 'notion-page-uuid' });
    const rows = toDeckRows([notionJob], [upload], [], []);
    expect(rows).toHaveLength(2);
  });

  it('preserves the Notion source badge on the surviving row', () => {
    const notionJob = makeJob({
      id: 1 as JobsId,
      type: 'page',
      status: 'done',
      object_id: 'notion-page-uuid',
      download_key: 'deck-abc123.apkg',
      upload_id: 42,
    });
    const matchingUpload = makeUpload({
      object_id: 'notion-page-uuid',
      key: 'deck-abc123.apkg',
    });
    const rows = toDeckRows([notionJob], [matchingUpload], [], []);
    expect(rows[0].source).toBe('notion');
  });

  it('does not suppress file rows for different object_ids', () => {
    const notionJob = makeJob({
      id: 1 as JobsId,
      type: 'page',
      status: 'done',
      object_id: 'notion-page-uuid',
      download_key: 'deck-abc123.apkg',
      upload_id: 42,
    });
    const unrelatedUpload = makeUpload({
      object_id: 'different-object-id',
      key: 'other-deck.apkg',
    });
    const rows = toDeckRows([notionJob], [unrelatedUpload], [], []);
    expect(rows).toHaveLength(2);
  });
});

describe('toDeckRows — MCP job dedupe', () => {
  it('suppresses the upload row so a done MCP deck with a download_key appears once', () => {
    const mcpJob = makeJob({
      id: 1 as JobsId,
      type: 'mcp',
      status: 'done',
      object_id: 'mcp-deck-uuid',
      download_key: 'deck-mcp123.apkg',
      upload_id: 77,
    });
    const matchingUpload = makeUpload({
      object_id: 'mcp-deck-uuid',
      key: 'deck-mcp123.apkg',
    });
    const rows = toDeckRows([mcpJob], [matchingUpload], [], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('job');
    expect(rows[0].source).toBe('mcp');
  });

  it('keeps the upload row when the MCP job has no download_key', () => {
    const mcpJob = makeJob({
      id: 1 as JobsId,
      type: 'mcp',
      status: 'done',
      object_id: 'mcp-deck-uuid',
      download_key: null,
      upload_id: null,
    });
    const upload = makeUpload({ object_id: 'mcp-deck-uuid' });
    const rows = toDeckRows([mcpJob], [upload], [], []);
    expect(rows).toHaveLength(2);
  });
});
