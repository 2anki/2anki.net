import { describe, expect, it } from 'vitest';
import { hasTruncationSignal } from './hasTruncationSignal';
import type JobResponse from '@server/types/JobResponse';
import type { JobsId } from '@server/data_layer/public/Jobs';

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

describe('hasTruncationSignal', () => {
  it('is true for a page-level truncated done Notion job', () => {
    expect(hasTruncationSignal(buildJob())).toBe(true);
  });

  it('is true for a nested-only truncation reporting zero page blocks', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_truncated',
        blocks_converted: 0,
        sub_deck_rules_skipped: false,
      }),
    });
    expect(hasTruncationSignal(job)).toBe(true);
  });

  it('is true when truncation rides along a higher-priority forbidden-blocks code', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_blocks_forbidden',
        forbidden_blocks: 2,
        blocks_converted: 0,
        sub_deck_rules_skipped: false,
      }),
    });
    expect(hasTruncationSignal(job)).toBe(true);
  });

  it('is false when the payload carries no block count', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_assets_dropped',
        dropped_assets: 3,
      }),
    });
    expect(hasTruncationSignal(job)).toBe(false);
  });

  it('accepts database jobs', () => {
    expect(hasTruncationSignal(buildJob({ type: 'database' }))).toBe(true);
  });

  it.each([['apkg_import'], ['claude'], ['conversion'], [null]])(
    'ignores %s jobs',
    (type) => {
      expect(hasTruncationSignal(buildJob({ type }))).toBe(false);
    }
  );

  it('ignores jobs that are not done', () => {
    expect(hasTruncationSignal(buildJob({ status: 'failed' }))).toBe(false);
  });

  it.each([[null], [''], ['not json'], ['{}']])(
    'ignores reason %s',
    (reason) => {
      expect(
        hasTruncationSignal(buildJob({ job_reason_failure: reason }))
      ).toBe(false);
    }
  );

  it('ignores a non-numeric block count', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_truncated',
        blocks_converted: 'many',
      }),
    });
    expect(hasTruncationSignal(job)).toBe(false);
  });
});
