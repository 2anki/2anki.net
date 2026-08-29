import { describe, expect, it } from 'vitest';
import { parseTruncationPayload } from './parseTruncationPayload';
import JobResponse from '../../../schemas/public/JobResponse';
import { JobsId } from '../../../schemas/public/Jobs';

function buildJob(overrides: Partial<JobResponse> = {}): JobResponse {
  return {
    id: 1 as JobsId,
    owner: 'owner-1',
    object_id: 'page-id',
    status: 'done',
    created_at: new Date('2026-06-01T11:30:00Z'),
    last_edited_time: new Date('2026-06-01T11:30:00Z'),
    title: 'Long Notion Page',
    type: 'page',
    job_reason_failure: JSON.stringify({
      code: 'notion_truncated',
      blocks_converted: 100,
      sub_deck_rules_skipped: false,
    }),
    card_count: null,
    restartable: false,
    download_key: 'deck.apkg',
    upload_id: null,
    empty_back_count: 0,
    ...overrides,
  };
}

describe('parseTruncationPayload', () => {
  it('parses a truncated done Notion page job', () => {
    expect(parseTruncationPayload(buildJob())).toEqual({
      blocksConverted: 100,
      subDeckRulesSkipped: false,
    });
  });

  it('parses the sub-deck rules flag', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_truncated',
        blocks_converted: 100,
        sub_deck_rules_skipped: true,
      }),
    });
    expect(parseTruncationPayload(job)).toEqual({
      blocksConverted: 100,
      subDeckRulesSkipped: true,
    });
  });

  it('accepts database jobs', () => {
    expect(
      parseTruncationPayload(buildJob({ type: 'database' }))
    ).not.toBeNull();
  });

  it.each([['apkg_import'], ['claude'], ['conversion'], [null]])(
    'ignores %s jobs',
    (type) => {
      expect(parseTruncationPayload(buildJob({ type }))).toBeNull();
    }
  );

  it('ignores jobs that are not done', () => {
    expect(parseTruncationPayload(buildJob({ status: 'failed' }))).toBeNull();
  });

  it('ignores the apkg_import done payload shape', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        total_notes: 10,
        imported: 10,
        notion_page_url: 'https://notion.so/x',
      }),
    });
    expect(parseTruncationPayload(job)).toBeNull();
  });

  it.each([[null], [''], ['not json'], ['{}']])(
    'ignores reason %s',
    (reason) => {
      expect(
        parseTruncationPayload(buildJob({ job_reason_failure: reason }))
      ).toBeNull();
    }
  );

  it('ignores payloads without a usable block count', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_truncated',
        blocks_converted: 'many',
      }),
    });
    expect(parseTruncationPayload(job)).toBeNull();
  });
});
