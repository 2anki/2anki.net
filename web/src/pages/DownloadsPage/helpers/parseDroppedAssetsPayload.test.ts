import { describe, expect, it } from 'vitest';
import { parseDroppedAssetsPayload } from './parseDroppedAssetsPayload';
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
    title: 'Page with images',
    type: 'page',
    job_reason_failure: JSON.stringify({
      code: 'notion_assets_dropped',
      dropped_assets: 3,
    }),
    card_count: null,
    restartable: false,
    download_key: 'deck.apkg',
    upload_id: null,
    empty_back_count: 0,
    ...overrides,
  };
}

describe('parseDroppedAssetsPayload', () => {
  it('parses the dropped-assets count from a done Notion page job', () => {
    expect(parseDroppedAssetsPayload(buildJob())).toBe(3);
  });

  it('reads dropped_assets even when the code is notion_truncated', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_truncated',
        blocks_converted: 100,
        sub_deck_rules_skipped: false,
        dropped_assets: 2,
      }),
    });
    expect(parseDroppedAssetsPayload(job)).toBe(2);
  });

  it('accepts database jobs', () => {
    expect(parseDroppedAssetsPayload(buildJob({ type: 'database' }))).toBe(3);
  });

  it('returns null when there is no dropped_assets field', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_truncated',
        blocks_converted: 100,
        sub_deck_rules_skipped: false,
      }),
    });
    expect(parseDroppedAssetsPayload(job)).toBeNull();
  });

  it('returns null for a zero count', () => {
    const job = buildJob({
      job_reason_failure: JSON.stringify({
        code: 'notion_assets_dropped',
        dropped_assets: 0,
      }),
    });
    expect(parseDroppedAssetsPayload(job)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(
      parseDroppedAssetsPayload(buildJob({ job_reason_failure: 'not-json' }))
    ).toBeNull();
  });

  it('returns null when the job is not done', () => {
    expect(
      parseDroppedAssetsPayload(buildJob({ status: 'processing' }))
    ).toBeNull();
  });

  it('returns null for non-Notion job types', () => {
    expect(parseDroppedAssetsPayload(buildJob({ type: 'claude' }))).toBeNull();
  });
});
