import { describe, expect, it } from 'vitest';
import { parseUnsupportedBlocksPayload } from './parseUnsupportedBlocksPayload';
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
    title: 'Page with unsupported blocks',
    type: 'page',
    job_reason_failure: JSON.stringify({
      code: 'notion_unsupported_blocks',
      unsupported_blocks: { child_database: 2, synced_block: 1 },
    }),
    card_count: null,
    restartable: false,
    download_key: 'deck.apkg',
    upload_id: null,
    ...overrides,
  };
}

describe('parseUnsupportedBlocksPayload', () => {
  it('parses the unsupported-block counts from a done Notion page job', () => {
    expect(parseUnsupportedBlocksPayload(buildJob())).toEqual({
      child_database: 2,
      synced_block: 1,
    });
  });

  it('reads unsupported_blocks even when the code is notion_assets_dropped', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_assets_dropped',
        dropped_assets: 3,
        unsupported_blocks: { child_database: 1 },
      }),
    });
    expect(parseUnsupportedBlocksPayload(job)).toEqual({ child_database: 1 });
  });

  it('accepts database jobs', () => {
    expect(
      parseUnsupportedBlocksPayload(buildJob({ type: 'database' }))
    ).toEqual({ child_database: 2, synced_block: 1 });
  });

  it('drops non-positive and non-integer counts', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_unsupported_blocks',
        unsupported_blocks: { child_database: 0, synced_block: 2, table: 1.5 },
      }),
    });
    expect(parseUnsupportedBlocksPayload(job)).toEqual({ synced_block: 2 });
  });

  it('returns null when there is no unsupported_blocks field', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_truncated',
        blocks_converted: 100,
        sub_deck_rules_skipped: false,
      }),
    });
    expect(parseUnsupportedBlocksPayload(job)).toBeNull();
  });

  it('returns null for an empty unsupported_blocks object', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_unsupported_blocks',
        unsupported_blocks: {},
      }),
    });
    expect(parseUnsupportedBlocksPayload(job)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(
      parseUnsupportedBlocksPayload(
        buildJob({ job_reason_failure: 'not-json' })
      )
    ).toBeNull();
  });

  it('returns null when the job is not done', () => {
    expect(
      parseUnsupportedBlocksPayload(buildJob({ status: 'processing' }))
    ).toBeNull();
  });

  it('returns null for non-Notion job types', () => {
    expect(
      parseUnsupportedBlocksPayload(buildJob({ type: 'claude' }))
    ).toBeNull();
  });
});
