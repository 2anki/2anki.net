import { describe, expect, it } from 'vitest';
import { parseForbiddenBlocksPayload } from './parseForbiddenBlocksPayload';
import JobResponse from '../../../schemas/public/JobResponse';
import { JobsId } from '../../../schemas/public/Jobs';

function buildJob(overrides: Partial<JobResponse> = {}): JobResponse {
  return {
    id: 1 as JobsId,
    owner: 'owner-1',
    object_id: 'page-id',
    status: 'done',
    created_at: new Date('2026-08-02T11:30:00Z'),
    last_edited_time: new Date('2026-08-02T11:30:00Z'),
    title: 'Study notes',
    type: 'page',
    job_reason_failure: JSON.stringify({
      code: 'notion_blocks_forbidden',
      forbidden_blocks: 2,
    }),
    restartable: false,
    download_key: 'deck.apkg',
    upload_id: null,
    ...overrides,
  };
}

describe('parseForbiddenBlocksPayload', () => {
  it('parses a forbidden-blocks done Notion page job', () => {
    expect(parseForbiddenBlocksPayload(buildJob())).toEqual({ count: 2 });
  });

  it('ignores a structure-rescued payload that merely carries the field', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_structure_rescued',
        rule: 'heading',
        forbidden_blocks: 4,
      }),
    });
    expect(parseForbiddenBlocksPayload(job)).toBeNull();
  });

  it('rejects a zero or missing count', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_blocks_forbidden',
        forbidden_blocks: 0,
      }),
    });
    expect(parseForbiddenBlocksPayload(job)).toBeNull();
  });

  it('ignores a still-running job', () => {
    expect(
      parseForbiddenBlocksPayload(buildJob({ status: 'active' }))
    ).toBeNull();
  });

  it('ignores an upload job type', () => {
    expect(
      parseForbiddenBlocksPayload(buildJob({ type: 'upload' }))
    ).toBeNull();
  });
});
