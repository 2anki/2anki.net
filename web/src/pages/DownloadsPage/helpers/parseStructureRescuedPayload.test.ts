import { describe, expect, it } from 'vitest';
import { parseStructureRescuedPayload } from './parseStructureRescuedPayload';
import JobResponse from '../../../schemas/public/JobResponse';
import { JobsId } from '../../../schemas/public/Jobs';

function buildJob(overrides: Partial<JobResponse> = {}): JobResponse {
  return {
    id: 1 as JobsId,
    owner: 'owner-1',
    object_id: 'page-id',
    status: 'done',
    created_at: new Date('2026-07-28T11:30:00Z'),
    last_edited_time: new Date('2026-07-28T11:30:00Z'),
    title: 'Study notes',
    type: 'page',
    job_reason_failure: JSON.stringify({
      code: 'notion_structure_rescued',
      rule: 'heading',
    }),
    restartable: false,
    download_key: 'deck.apkg',
    upload_id: null,
    ...overrides,
  };
}

describe('parseStructureRescuedPayload', () => {
  it('parses a structure-rescued done Notion page job', () => {
    expect(parseStructureRescuedPayload(buildJob())).toEqual({
      rule: 'heading',
    });
  });

  it('ignores a guessed-columns payload', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_columns_guessed',
        front_field: 'Notes',
        back_field: 'Tags',
      }),
    });
    expect(parseStructureRescuedPayload(job)).toBeNull();
  });

  it('rejects an unknown rule', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_structure_rescued',
        rule: 'sql-injection',
      }),
    });
    expect(parseStructureRescuedPayload(job)).toBeNull();
  });

  it('ignores a still-running job', () => {
    expect(
      parseStructureRescuedPayload(buildJob({ status: 'active' }))
    ).toBeNull();
  });

  it('ignores an upload job type', () => {
    expect(
      parseStructureRescuedPayload(buildJob({ type: 'upload' }))
    ).toBeNull();
  });
});
