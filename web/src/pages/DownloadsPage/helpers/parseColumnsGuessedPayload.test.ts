import { describe, expect, it } from 'vitest';
import { parseColumnsGuessedPayload } from './parseColumnsGuessedPayload';
import JobResponse from '../../../schemas/public/JobResponse';
import { JobsId } from '../../../schemas/public/Jobs';

function buildJob(overrides: Partial<JobResponse> = {}): JobResponse {
  return {
    id: 1 as JobsId,
    owner: 'owner-1',
    object_id: 'db-id',
    status: 'done',
    created_at: new Date('2026-07-01T11:30:00Z'),
    last_edited_time: new Date('2026-07-01T11:30:00Z'),
    title: 'Vocabulary',
    type: 'database',
    job_reason_failure: JSON.stringify({
      code: 'notion_columns_guessed',
      front_field: 'Notes',
      back_field: 'Tags',
    }),
    card_count: null,
    restartable: false,
    download_key: 'deck.apkg',
    upload_id: null,
    ...overrides,
  };
}

describe('parseColumnsGuessedPayload', () => {
  it('parses a guessed-columns done Notion database job', () => {
    expect(parseColumnsGuessedPayload(buildJob())).toEqual({
      frontField: 'Notes',
      backField: 'Tags',
    });
  });

  it('accepts page jobs', () => {
    expect(
      parseColumnsGuessedPayload(buildJob({ type: 'page' }))
    ).not.toBeNull();
  });

  it.each([['apkg_import'], ['claude'], ['conversion'], [null]])(
    'ignores %s jobs',
    (type) => {
      expect(parseColumnsGuessedPayload(buildJob({ type }))).toBeNull();
    }
  );

  it('ignores jobs that are not done', () => {
    expect(
      parseColumnsGuessedPayload(buildJob({ status: 'failed' }))
    ).toBeNull();
  });

  it('ignores the truncation payload shape', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_truncated',
        blocks_converted: 100,
      }),
    });
    expect(parseColumnsGuessedPayload(job)).toBeNull();
  });

  it.each([[null], [''], ['not json'], ['{}']])(
    'ignores reason %s',
    (reason) => {
      expect(
        parseColumnsGuessedPayload(buildJob({ job_reason_failure: reason }))
      ).toBeNull();
    }
  );

  it('ignores payloads with a non-string field name', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_columns_guessed',
        front_field: 3,
        back_field: 'Tags',
      }),
    });
    expect(parseColumnsGuessedPayload(job)).toBeNull();
  });
});
